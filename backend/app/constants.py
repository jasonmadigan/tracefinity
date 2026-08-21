from typing import Literal

GF_GRID = 42.0

# Bin geometry is generated in full before bed-size splitting. Keep the
# resource ceiling tied to total grid cells while allowing long, narrow bins.
MIN_BIN_GRID_UNITS = 1.0
MAX_BIN_GRID_UNITS = 25.0
MAX_BIN_GRID_CELLS = 100

PaperSize = Literal["a4", "letter", "a3", "tabloid"]

PAPER_SIZES: dict[PaperSize, tuple[float, float]] = {
    "a4": (210, 297),
    "letter": (215.9, 279.4),
    "a3": (297, 420),
    "tabloid": (279.4, 431.8),
}
