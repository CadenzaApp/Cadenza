"""Browser launch waits for a healthy tunnel and never opens after failure."""

import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location(
    "open_metrics", Path(__file__).with_name("open-metrics.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.server.requests += 1
        self.send_response(200)
        self.end_headers()
        self.wfile.write(self.server.body)

    def log_message(self, *args):
        pass


class BrowserTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), HealthHandler)
        self.server.requests = 0
        self.server.body = json.dumps({"database": "starting"}).encode()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.process = Mock()
        self.process.poll.return_value = None

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_opens_once_only_after_grafana_is_ready(self):
        ready = threading.Event()

        def become_ready():
            self.server.body = json.dumps({"database": "ok"}).encode()
            ready.set()

        timer = threading.Timer(0.05, become_ready)
        timer.start()

        def open_browser(url, **kwargs):
            self.assertTrue(ready.is_set())
            return True

        browser = Mock(side_effect=open_browser)
        module.open_when_ready(
            self.process,
            self.server.server_port,
            timeout=2,
            browser_open=browser,
        )
        timer.join()
        browser.assert_called_once_with(
            f"http://localhost:{self.server.server_port}/d/cadenza-backend", new=2
        )

    def test_does_not_open_an_unrelated_http_service(self):
        self.server.body = b"<html>not Grafana</html>"
        browser = Mock()
        module.open_when_ready(
            self.process,
            self.server.server_port,
            timeout=0.05,
            browser_open=browser,
        )
        browser.assert_not_called()

    def test_does_not_open_after_tunnel_exit(self):
        self.server.body = b'{"database":"ok"}'
        self.process.poll.return_value = 1
        browser = Mock()
        module.open_when_ready(
            self.process, self.server.server_port, browser_open=browser
        )
        browser.assert_not_called()
        self.assertEqual(self.server.requests, 0)
