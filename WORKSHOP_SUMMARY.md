# NCICS 2026 Workshop Summary
**3-Day Pangeo Course — Asheville, March 2026**

## Overview

This workshop introduced participants to cloud-native scientific data workflows using the Pangeo ecosystem, covering everything from raw data ingestion to interactive web applications. The course combined lectures, hands-on tutorials, and a project block where participants worked on their own datasets.

---

## Day 1: Cloud-Native Fundamentals & AI Assistance

### The Pangeo Ecosystem
Introduced the Pangeo stack as a platform for FAIR (Findable, Accessible, Interoperable, Reusable) scientific data: xarray, Zarr, Dask, and cloud object storage as the core building blocks for scalable geoscience workflows.

### VirtualiZarr and Icechunk
**Lecture:** [`0_VirtualDatasets.ipynb`](./0_VirtualDatasets.ipynb)

Covered two complementary tools for cloud-native data access without copying:
- **VirtualiZarr** — creates metadata-only virtual references to existing NetCDF/HDF5/GeoTIFF files on S3, enabling Zarr-compatible access without data movement
- **Icechunk** — a transactional, versioned chunk store that can hold virtual or materialized Zarr data; supports Git-like commits and appends
- **Forecast Model Run Collections (FMRC)** — managing overlapping forecast times across model runs using Icechunk versioning and Rolodex xarray indices

**Tutorials:**
- [`virtualizarr_s3_example.ipynb`](./virtualizarr_s3_example.ipynb) — Core VirtualiZarr workflow: open NetCDF from S3, combine files, write to Icechunk, read back with xarray
- [`virtualizarr_ndvi_cdr.ipynb`](./virtualizarr_ndvi_cdr.ipynb) — Applied to NOAA CDR NDVI data: 5-day virtual dataset with hvplot visualization
- [`taranto-icechunk-append.ipynb`](./taranto-icechunk-append.ipynb) — Incremental append workflow for SHYFEM coastal forecast data using date-based diffing
- [`taranto-icechunk-FMRC.ipynb`](./taranto-icechunk-FMRC.ipynb) — Reading an FMRC Icechunk store; extracting BestEstimate time series

### Coding with AI Agents
**Lecture:** [`0_Coding.ipynb`](./0_Coding.ipynb)

Survey of modern Python development tooling: Conda/Micromamba environments, JupyterLab and VSCode as IDEs, and practical use of AI coding assistants (Claude, Gemini) for code generation, refactoring, and exploratory analysis.

---

## Day 2: Discovery & Visualization

### HoloViz for Dynamic Visualization
**Lecture:** [`0_Holoviz.ipynb`](./0_Holoviz.ipynb)

Introduction to the HoloViz ecosystem — hvPlot, HoloViews, Panel, GeoViews — for building interactive visualizations and dashboards directly from xarray/pandas objects. Emphasis on going from exploratory plots to shareable dashboards with minimal code changes.

**Tutorial:** [`hvplot_tutorial.ipynb`](./hvplot_tutorial.ipynb) — Hands-on practice with geographic plots, linked selections, and widgets.

### STAC Catalogs for Search
**Lecture:** [`0_STAC.ipynb`](./0_STAC.ipynb)

Covered the SpatioTemporal Asset Catalog (STAC) specification as the standard for discovering cloud-native geospatial data:
- STAC Items, Collections, and Catalogs
- Asset types: COGs, Zarr, virtual Icechunk stores
- Static vs. dynamic (API) catalogs
- Querying with `pystac-client`; opening STAC items directly as xarray datasets via `xpystac`

**Tutorials/Projects:**
- [`build_static_catalog.ipynb`](./build_static_catalog.ipynb) — Building a self-contained static STAC catalog
- [`build_dynamical_catalog_full.ipynb`](./build_dynamical_catalog_full.ipynb) — Full dynamic catalog workflow
- [`ndvi_cdr_stac_item.ipynb`](./ndvi_cdr_stac_item.ipynb) — Creating and validating a STAC Item for a virtual Icechunk store on Cloudflare R2
- [`ndvi_cdr_pyramid_stac_item.ipynb`](./ndvi_cdr_pyramid_stac_item.ipynb) — STAC Item for a multiscale pyramid store referencing both virtual and materialized Icechunk repositories
- [`query_rustac.ipynb`](./query_rustac.ipynb) — Querying a GeoParquet STAC catalog with rustac

### Cloud-Native Remote Sensing
**Lecture:** [`0_RemoteSensing.ipynb`](./0_RemoteSensing.ipynb)

End-to-end workflow for satellite data:
- Searching STAC APIs (Planetary Computer, Element 84) with `pystac-client`
- Opening results as analysis-ready xarray datasets with `odc-stac`
- Efficient remote COG access via GDAL environment variable tuning
- Computing spectral indices (NDVI, NDSI) on clipped regions of interest

**Tutorials:**
- [`single-cog.ipynb`](./single-cog.ipynb) — Cloud-Optimized GeoTIFF access patterns
- [`planetary_computer_1.ipynb`](./planetary_computer_1.ipynb) / [`planetary_computer_2.ipynb`](./planetary_computer_2.ipynb) — Microsoft Planetary Computer STAC search and analysis
- [`eopf_geozarr_demo.ipynb`](./eopf_geozarr_demo.ipynb) — Sentinel-2 L2A in EOPF Zarr format: STAC search, NDVI/NDSI computation, multi-resolution access (60m vs. 10m)

---

## Day 3: Applications & Project Show-and-Tell

### Web Apps for Model Output
**Lecture:** [`0_WebApps.ipynb`](./0_WebApps.ipynb)

Three architectural patterns for exposing scientific data on the web:
1. **Server-side (Bokeh/Django)** — Live Python computation with browser rendering
2. **OGC API services (xpublish)** — Standardized REST endpoints serving Zarr/xarray data
3. **Client-side Zarr (zarr-layer)** — Direct browser access to Zarr/Icechunk stores with no server required; tiles rendered in WebGL

**Demo app:** [`zarr-layer-demo/`](./zarr-layer-demo/) — A deployed browser-based NDVI viewer that:
  - Reads a multiscale Zarr pyramid directly from Cloudflare R2 Icechunk
  - Loads the store URL dynamically from a STAC item
  - Provides a time slider and live pyramid level display
  - Deployed to GitHub Pages at `/NCICS-2026/zarr-layer-demo/`

**Tutorial:** [`ndvi_cdr_topozarr_pyramid.ipynb`](./ndvi_cdr_topozarr_pyramid.ipynb) — Building a 4-level GeoZarr multiscale pyramid with topozarr, writing materialized chunks to Icechunk on Cloudflare R2

### Project Show-and-Tell

Participants presented work on their own datasets, including:
- **SHYFEM unstructured ocean model** — Icechunk ingestion, STAC catalog, and FMRC workflows ([`explore_shyfem.ipynb`](./explore_shyfem.ipynb))
- **FVCOM Gulf of Maine hindcast** — Unstructured grid visualization with xugrid ([`FVCOM_xugrid.ipynb`](./FVCOM_xugrid.ipynb))
- **Copernicus Marine** — Model output, EO, and in-situ sensor data access ([`copernicus_marine_model.ipynb`](./copernicus_marine_model.ipynb), [`copernicus_marine_EO.ipynb`](./copernicus_marine_EO.ipynb), [`copernicus_marine_insitu.ipynb`](./copernicus_marine_insitu.ipynb))
- **ERDDAP sensor data** — Accessing in-situ observations via ERDDAP ([`erddap_sensor_data.ipynb`](./erddap_sensor_data.ipynb))
- **CMIP6 global mean temperature** — Google Cloud CMIP6 via Icechunk ([`global-mean-temp_google_cmip.ipynb`](./global-mean-temp_google_cmip.ipynb))

---

## Key Technologies

| Category | Tools |
|----------|-------|
| Array / data model | xarray, numpy, pandas, Dask |
| Cloud-native formats | Zarr, Icechunk, Cloud-Optimized GeoTIFF (COG), EOPF Zarr |
| Virtual datasets | VirtualiZarr |
| Multiscale pyramids | topozarr |
| Object storage | AWS S3, Cloudflare R2, Pangeo EOSC MinIO (s3fs, boto3) |
| Discovery | STAC (pystac, pystac-client, xpystac), rustac, GeoParquet |
| Visualization | HoloViz (hvPlot, HoloViews, Panel, GeoViews) |
| Remote sensing | rioxarray, odc-stac, GDAL |
| Unstructured grids | xugrid |
| Web apps | zarr-layer (JS), xpublish |
| AI coding | Claude Code, Gemini |
