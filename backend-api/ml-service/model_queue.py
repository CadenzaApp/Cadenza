"""One inference worker with bounded admission, including disconnected callers."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore


class ModelBusy(Exception):
    pass


class ModelQueue:
    def __init__(self, capacity=9):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="model")
        self.slots = BoundedSemaphore(capacity)

    async def run(self, fn, body):
        if not self.slots.acquire(blocking=False):
            raise ModelBusy()
        try:
            future = self.executor.submit(fn, body)
        except BaseException:
            self.slots.release()
            raise
        # Keep submitted jobs admitted until the executor actually completes them.
        # Cancelling a queued Future leaves its work item inside the executor queue;
        # releasing its slot early would allow that queue to grow without a bound.
        future.add_done_callback(lambda _: self.slots.release())
        return await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(future)), timeout=40)
