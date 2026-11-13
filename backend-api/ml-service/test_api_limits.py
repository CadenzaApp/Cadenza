"""Exercise real HTTP validation/overload responses with a fake model loader."""
import os
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

import numpy as np  # noqa: F401 - preload native extensions before patch.dict restores sys.modules.
from fastapi.testclient import TestClient

# No token, model download or inference is needed for HTTP admission tests.
with patch.dict(os.environ, {"MODEL_REVISION": "test", "HF_TOKEN": "test"}), patch.dict(
    sys.modules,
    {"dotenv": types.SimpleNamespace(load_dotenv=lambda: None), "sentence_transformers": types.SimpleNamespace(
        SentenceTransformer=lambda *args, **kwargs: types.SimpleNamespace()
    )},
):
    import main


class ApiLimits(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_oversized_inputs_are_rejected_before_inference(self):
        for body in [{"content": "x" * 501}, {"interests": [{"name": "x", "itype": "artist"}] * 101},
                     {"interests": [{"name": "x" * 201, "itype": "genre"}]}]:
            with patch.object(main.model_work, "run", new_callable=AsyncMock) as work:
                self.assertEqual(self.client.post("/embedding", json=body).status_code, 422)
                work.assert_not_called()

    def test_busy_model_returns_503_without_breaking_readiness(self):
        with patch.object(main.model_work, "run", new_callable=AsyncMock, side_effect=main.ModelBusy()):
            response = self.client.post("/embedding", json={"content": "jazz"})
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.headers["retry-after"], "5")
            self.assertEqual(self.client.get("/health/ready").status_code, 200)
