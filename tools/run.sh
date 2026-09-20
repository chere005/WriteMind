#!/bin/sh
# Build the Debug app and open it.
set -e
cd "$(dirname "$0")/.."
APP=$(sh tools/build.sh --debug | tail -1)
open "$APP"
