#!/usr/bin/env bash
# coco P1b merge guard — deny a raw git merge/push to base while a coco goal is active.
# `coco install-hooks` writes an installed copy pointing at the resolved binary; this tracked
# template uses `coco` on PATH (install `@nickcao/coco` globally, or replace with an absolute path).
exec coco guard-hook
