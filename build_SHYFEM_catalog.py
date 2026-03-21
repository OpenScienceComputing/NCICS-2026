"""
Create and upload a static STAC catalog for GlobalCoast SHYFEM icechunk datasets.
Uploads JSON items + catalog to s3://rsignell4-protocoast/stac/
Also writes a stac-geoparquet file for fast querying via rustac.
"""
import json
import os
import tempfile
import boto3
import pystac
import stac_geoparquet.arrow as sga
from datetime import datetime, timezone

ENDPOINT_URL = "https://pangeo-eosc-minioapi.vm.fedcloud.eu"
BUCKET = "rsignell4-protocoast"
STAC_PREFIX = "stac"

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT_URL,
    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
)

def upload_json(key, obj):
    body = json.dumps(obj, indent=2)
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=body,
        ContentType="application/json",
    )
    print(f"Uploaded s3://{BUCKET}/{key}")

# ── STAC Item: Taranto ─────────────────────────────────────────────────────
taranto_item = pystac.Item(
    id="taranto-icechunk",
    geometry={
        "type": "Polygon",
        "coordinates": [[
            [16.487, 39.024],
            [18.346, 39.024],
            [18.346, 40.520],
            [16.487, 40.520],
            [16.487, 39.024],
        ]],
    },
    bbox=[16.487, 39.024, 18.346, 40.520],
    datetime=None,
    properties={
        "title": "SHYFEM Taranto (Gulf of Taranto, Mediterranean)",
        "description": "SHYFEM-MPI unstructured grid ocean model output for the Gulf of Taranto, produced by CMCC.",
        "start_datetime": "2025-09-08T00:00:00Z",
        "end_datetime": "2026-03-05T00:00:00Z",
        "model": "SHYFEM-MPI",
        "institution": "CMCC",
        "variables": ["temperature", "salinity", "u_velocity", "v_velocity", "water_level"],
        "conventions": "CF-1.4",
    },
)

taranto_item.add_asset(
    "icechunk",
    pystac.Asset(
        href=f"s3://{BUCKET}/icechunk/taranto-icechunk-v1",
        title="Icechunk store",
        media_type="application/vnd+icechunk",
        roles=["data"],
        extra_fields={
            "icechunk:endpoint_url": ENDPOINT_URL,
            "icechunk:bucket": BUCKET,
            "icechunk:prefix": "icechunk/taranto-icechunk-v1",
            "icechunk:force_path_style": True,
        },
    ),
)

# ── STAC Item: Antsiranana ─────────────────────────────────────────────────
antsiranana_item = pystac.Item(
    id="antsiranana-icechunk",
    geometry={
        "type": "Polygon",
        "coordinates": [[
            [49.192, -12.349],
            [49.608, -12.349],
            [49.608, -12.022],
            [49.192, -12.022],
            [49.192, -12.349],
        ]],
    },
    bbox=[49.192, -12.349, 49.608, -12.022],
    datetime=None,
    properties={
        "title": "SHYFEM Antsiranana Bay, Madagascar",
        "description": "SHYFEM unstructured grid ocean model output for Antsiranana Bay, Madagascar, produced by ISMAR-CNR.",
        "start_datetime": "2021-03-31T00:00:00Z",
        "end_datetime": "2021-04-06T00:00:00Z",
        "model": "SHYFEM",
        "institution": "ISMAR-CNR",
        "variables": ["temperature", "salinity", "u_velocity", "v_velocity", "water_level"],
        "conventions": "CF-1.4",
    },
)

antsiranana_item.add_asset(
    "icechunk",
    pystac.Asset(
        href=f"s3://{BUCKET}/icechunk/antsiranana-icechunk",
        title="Icechunk store",
        media_type="application/vnd+icechunk",
        roles=["data"],
        extra_fields={
            "icechunk:endpoint_url": ENDPOINT_URL,
            "icechunk:bucket": BUCKET,
            "icechunk:prefix": "icechunk/antsiranana-icechunk",
            "icechunk:force_path_style": True,
        },
    ),
)

# ── STAC Catalog ───────────────────────────────────────────────────────────
catalog = pystac.Catalog(
    id="globalcoast-shyfem",
    description="GlobalCoast SHYFEM icechunk stores — unstructured ocean model output",
    title="GlobalCoast SHYFEM Catalog",
)
catalog.add_item(taranto_item)
catalog.add_item(antsiranana_item)

# ── Serialise and upload ───────────────────────────────────────────────────
catalog_base_url = f"https://{ENDPOINT_URL.split('https://')[1]}/{BUCKET}/{STAC_PREFIX}"

catalog.normalize_hrefs(catalog_base_url)

# Upload items
upload_json(f"{STAC_PREFIX}/taranto-icechunk/taranto-icechunk.json", taranto_item.to_dict())
upload_json(f"{STAC_PREFIX}/antsiranana-icechunk/antsiranana-icechunk.json", antsiranana_item.to_dict())

# Upload catalog
upload_json(f"{STAC_PREFIX}/catalog.json", catalog.to_dict())

# ── GeoParquet ─────────────────────────────────────────────────────────────
items_dicts = [taranto_item.to_dict(), antsiranana_item.to_dict()]
with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
    parquet_path = f.name
table = sga.parse_stac_items_to_arrow(iter(items_dicts))
sga.to_parquet(table, parquet_path)
with open(parquet_path, "rb") as f:
    s3.put_object(
        Bucket=BUCKET,
        Key=f"{STAC_PREFIX}/catalog.parquet",
        Body=f.read(),
        ContentType="application/vnd.apache.parquet",
    )
print(f"Uploaded s3://{BUCKET}/{STAC_PREFIX}/catalog.parquet")

print("\nDone. Catalog URL:")
print(f"  {catalog_base_url}/catalog.json")
print(f"  {catalog_base_url}/catalog.parquet")
