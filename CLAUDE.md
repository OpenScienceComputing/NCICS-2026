# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a research/educational project for the NCICS-2026 workshop focused on cloud-native scientific data access and STAC catalog building. The repository consists primarily of Jupyter notebooks and one Python script, with no formal package structure.

## Running Notebooks

Notebooks are designed to run in a Jupyter environment with scientific Python packages installed. There is no `requirements.txt` or `environment.yml` — the environment is assumed to be pre-configured with the workshop's conda/mamba environment.

To run a notebook:
```bash
jupyter notebook <notebook_name>.ipynb
# or
jupyter lab
```

To run the STAC catalog build script:
```bash
python build_SHYFEM_catalog.py
```

## Architecture

### Data Catalog Building
- **`build_SHYFEM_catalog.py`** — Standalone script to create STAC items for SHYFEM (unstructured grid ocean model) datasets backed by icechunk storage, upload to Pangeo EOSC MinIO S3, and generate GeoParquet files for rustac querying.
- **`build_static_catalog.ipynb`** and **`build_dynamical_catalog_full.ipynb`** — Notebook workflows for building STAC catalogs for weather datasets (GFS, HRRR, NLDAS-3) using `pystac` with `SELF_CONTAINED` relative links for STAC Browser compatibility.

### Key Patterns Used Across Notebooks
- **Object storage access**: S3-compatible stores via `s3fs`/`boto3` (Pangeo EOSC MinIO, AWS S3)
- **Cloud-native formats**: Zarr, icechunk, Cloud-Optimized GeoTIFFs (COGs)
- **GDAL env var optimization** for efficient remote COG reads (e.g., `GDAL_HTTP_MERGE_CONSECUTIVE_RANGES`, `CPL_VSIL_CURL_ALLOWED_EXTENSIONS`)
- **Virtual Zarr stores**: `virtualizarr` for creating virtual references without copying data
- **xpystac backend**: Register with `xarray` so STAC items/collections open directly via `xr.open_dataset(stac_item)`
- **Dask**: Used throughout for lazy/parallel computation on large arrays

### Notebook Categories
- `0*_Lecture.ipynb` — Lecture materials (04–11)
- `*_tutorial.ipynb` — Hands-on tutorials (hvplot, xarray, zarr, object storage, COG)
- `*_explore.ipynb` / data-source notebooks — Working with specific datasets (COAWST, Copernicus Marine, Planetary Computer, ERDDAP, SHYFEM)
- `taranto-icechunk-*.ipynb` — Icechunk append/FMRC workflows for Taranto bay ocean model

### Primary Libraries
`xarray`, `rioxarray`, `pystac`, `icechunk`, `zarr`, `s3fs`, `boto3`, `hvplot`, `dask`, `pandas`, `numpy`, `virtualizarr`, `xpystac`
