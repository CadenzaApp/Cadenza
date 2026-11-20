"""Admission tests without importing Torch, loading a model, or using a database."""
import asyncio
import threading
import unittest

from model_queue import ModelBusy, ModelQueue


class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_running_work_keeps_its_slot(self):
        queue = ModelQueue(capacity=1)
        started, finish = threading.Event(), threading.Event()

        def work(_):
            started.set()
            finish.wait(5)

        task = asyncio.create_task(queue.run(work, None))
        try:
            while not started.is_set():
                await asyncio.sleep(0.001)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            with self.assertRaises(ModelBusy):
                await queue.run(lambda _: None, None)
        finally:
            finish.set()
            await asyncio.to_thread(queue.executor.shutdown, wait=True)
        self.assertTrue(queue.slots.acquire(blocking=False))
        queue.slots.release()

    async def test_cancelled_queued_work_still_counts_until_executor_completes_it(self):
        queue = ModelQueue(capacity=2)
        started, finish = threading.Event(), threading.Event()
        def work(_):
            started.set()
            finish.wait(5)
        first = asyncio.create_task(queue.run(work, None))
        second = None
        try:
            while not started.is_set():
                await asyncio.sleep(0.001)
            second = asyncio.create_task(queue.run(lambda _: 2, None))
            await asyncio.sleep(0.01)
            with self.assertRaises(ModelBusy):
                await queue.run(lambda _: 3, None)
            second.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await second
            with self.assertRaises(ModelBusy):
                await queue.run(lambda _: 3, None)
            finish.set()
            await first
            self.assertEqual(await queue.run(lambda _: 4, None), 4)
        finally:
            finish.set()
            await asyncio.gather(first, *([second] if second else []), return_exceptions=True)
            await asyncio.to_thread(queue.executor.shutdown, wait=True)

    async def test_worker_failure_releases_slot(self):
        queue = ModelQueue(capacity=1)
        def fail(_):
            raise ValueError("test")
        try:
            with self.assertRaises(ValueError):
                await queue.run(fail, None)
            self.assertEqual(await queue.run(lambda _: 42, None), 42)
        finally:
            queue.executor.shutdown()
