"""Health/concurrency tests with a fake encoder. No weights, tokens, or database."""

import asyncio
import importlib.util
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import httpx
import numpy as np


class FakeModel:
    def __init__(self, *args, **kwargs):
        self.started = threading.Event()
        self.release = threading.Event()
        self.lock = threading.Lock()
        self.active = 0
        self.peak_active = 0

    def encode_document(self, content):
        with self.lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)
        self.started.set()
        try:
            if not self.release.wait(3):
                raise RuntimeError("test did not release encoder")
            return np.zeros(768)
        finally:
            with self.lock:
                self.active -= 1


class ModelLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        name = "_cadenza_ml_lifecycle_test"
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name("main.py"))
        self.module = importlib.util.module_from_spec(spec)
        modules = {
            name: self.module,
            "sentence_transformers": SimpleNamespace(SentenceTransformer=FakeModel),
            "dotenv": SimpleNamespace(load_dotenv=lambda: None),
        }
        with patch.dict(sys.modules, modules), patch.dict(
            os.environ, {"HF_TOKEN": "test", "MODEL_REVISION": "test"}
        ):
            spec.loader.exec_module(self.module)
        self.model = self.module.model
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.module.app), base_url="http://test"
        )

    async def asyncTearDown(self):
        self.model.release.set()
        await self.client.aclose()
        self.module.model_work.executor.shutdown(wait=True, cancel_futures=True)

    async def test_health_responds_while_inference_is_busy(self):
        request = asyncio.create_task(self.client.post("/embedding", json={"content": "test"}))
        try:
            self.assertTrue(await asyncio.to_thread(self.model.started.wait, 1))
            response = await asyncio.wait_for(self.client.get("/health/ready"), timeout=1)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"status": "ready"})
            self.assertFalse(request.done())
        finally:
            self.model.release.set()
        response = await request
        self.assertEqual(len(response.json()["embedding"]), 768)

    async def test_cancelled_caller_cannot_make_model_work_run_in_parallel(self):
        first = asyncio.create_task(self.client.post("/embedding", json={"content": "first"}))
        self.assertTrue(await asyncio.to_thread(self.model.started.wait, 1))
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        second = asyncio.create_task(self.client.post("/embedding", json={"content": "second"}))
        try:
            await asyncio.sleep(0.05)
            self.assertFalse(second.done())
            self.assertEqual((await self.client.get("/health/ready")).status_code, 200)
        finally:
            self.model.release.set()
        self.assertEqual((await second).status_code, 200)
        self.assertEqual(self.model.peak_active, 1)

    async def test_bad_input_is_rejected_without_changing_readiness(self):
        self.assertEqual((await self.client.post("/embedding", json={})).status_code, 422)
        self.assertEqual((await self.client.get("/health/ready")).status_code, 200)


if __name__ == "__main__":
    unittest.main()
