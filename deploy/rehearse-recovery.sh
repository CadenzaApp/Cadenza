#!/bin/bash
# The former manual-restart rehearsal is unsafe with automatic replacement active.
echo 'Manual recovery rehearsal retired. Use the native ASG failure rehearsal in deploy/recovery/README.md.' >&2
exit 1
