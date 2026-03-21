# Jupyter Kernel Setup

These scripts install the Jupyter kernels you need to run the NCICS-2026 notebooks on your [Coder](https://coder.com) workspace.

## Setup (two commands)

```bash
git clone https://github.com/OpenScienceComputing/NCICS-2026.git ~/repos/NCICS-2026
bash ~/repos/NCICS-2026/scripts/setup-kernels.sh
```

Then **refresh JupyterLab** — both kernels will appear in the launcher:

| Kernel | Contents |
|---|---|
| `protocoast-notebook (py3.12)` | Full geospatial/oceanography stack (xarray, dask, cartopy, rasterio, icechunk, ...) |
| `eopf-notebook (py3.12)` | EOPF data access (xarray-eopf, hvplot, datashader, geoviews) |

## Notes

- First-time installation takes several minutes (downloading packages). Subsequent runs are fast.
- Each kernel lives in `~/envs/<kernel-name>/` as an isolated Python 3.12 virtual environment.
- If your workspace is **rebuilt** (not just restarted), re-run `setup-kernels.sh` to restore the kernels.
