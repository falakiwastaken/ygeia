"""
Local dev server for Ygeia.

Plain `python -m http.server` lets the browser heuristically cache JS, which during
development means edits appear not to have happened — the same failure mode the service
worker causes, from a second direction. This sends no-store on everything so a reload
always reflects the files on disk.

Not used in production: the real app is static files plus sw.js, and the caching there is
the point.
"""
import functools
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Serve the repo, not whatever directory the launcher happened to start in.
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(SimpleHTTPRequestHandler):
    # HTTP/1.0 closes the connection per response, which makes Chrome's service-worker
    # script fetch fail with a bare "unknown error". Registration needs keep-alive.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        # sw.js must stay storable: a service worker script served no-store fails to
        # register in some browsers, which would break the very thing being tested.
        # max-age=0 still forces revalidation on every load.
        if self.path.split("?")[0].endswith("sw.js"):
            self.send_header("Cache-Control", "max-age=0")
        else:
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
