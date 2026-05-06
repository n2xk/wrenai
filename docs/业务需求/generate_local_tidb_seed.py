#!/usr/bin/env python3
"""Legacy streaming generator for local TiDB seed SQL.

The default deploy/test path now imports `docs/业务需求/seed_data_local/*.sql`
directly. Use `generate_seed_data_local.py` to materialize those v1.3-ready
files from raw `seed_data_refer/` dumps. This script remains as a diagnostic
fallback for one-shot streaming imports:

  python3 docs/业务需求/generate_local_tidb_seed.py > /tmp/local_tidb_seed.sql

For a direct local import, prefer piping to the TiDB/MySQL client.
"""

from __future__ import annotations

import argparse
import signal
import sys
from pathlib import Path

from local_tidb_seed_transform import (
    DEFAULT_BATCH_SIZE,
    DEFAULT_REFERENCE_DIR,
    DEFAULT_REGRESSION_OVERLAY_FILE,
    DEFAULT_SUPPLEMENTAL_SEED_FILES,
    iter_local_seed_sql,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reference-dir",
        type=Path,
        default=DEFAULT_REFERENCE_DIR,
        help="Directory containing saas_prod.sql and saas_warehouse.sql.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional output file. Defaults to stdout.",
    )
    parser.add_argument(
        "--no-supplemental-external-metrics",
        action="store_true",
        help="Do not append docs/业务需求/external-data/full_external_metrics_daily.sql.",
    )
    parser.add_argument(
        "--regression-overlay-file",
        type=Path,
        default=None,
        help=(
            "Optional legacy fixed regression fixture SQL to append after reference data. "
            "Defaults to not appending any fixture."
        ),
    )
    parser.add_argument(
        "--no-regression-overlay",
        action="store_true",
        help="Do not append the legacy 990001/990011 local regression overlay.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Maximum rows per generated INSERT for reference dump imports.",
    )
    return parser.parse_args()


def main() -> None:
    if hasattr(signal, "SIGPIPE"):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    args = parse_args()
    supplemental_files = [] if args.no_supplemental_external_metrics else DEFAULT_SUPPLEMENTAL_SEED_FILES
    regression_overlay_file = None if args.no_regression_overlay else args.regression_overlay_file
    output = args.output.open("w", encoding="utf-8") if args.output else sys.stdout
    close_output = args.output is not None
    try:
        for statement in iter_local_seed_sql(
            args.reference_dir,
            regression_overlay_file,
            supplemental_files,
            batch_size=max(args.batch_size, 1),
        ):
            output.write(statement.rstrip())
            output.write("\n")
    finally:
        if close_output:
            output.close()


if __name__ == "__main__":
    main()
