#!/bin/sh
# tdtp — test, deploy, tag, push: the full lane. Everything dtp does, with the
# unit suite in front of it. See tools/dtp.sh for the lane itself.
exec sh "$(dirname "$0")/dtp.sh" --full "$@"
