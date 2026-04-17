import ee
from services.auth_service import init_firebase
from services.gee_service import initialize_gee

init_firebase()
initialize_gee()

geom = ee.Geometry.Point([75.8131346, 18.1676592]).buffer(100)

collection = (ee.ImageCollection("COPERNICUS/S1_GRD")
    .filterBounds(geom)
    .filterDate('2024-01-01', '2024-12-31')
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .select(['VV', 'VH'])
)
median = collection.median()

# Reduce
stats = median.reduceRegion(reducer=ee.Reducer.mean(), geometry=geom, scale=10).getInfo()
print("Stats in dB:", stats)

if stats and 'VV' in stats and stats['VV'] is not None:
    vv_db = stats['VV']
    vh_db = stats['VH']
    vv_lin = 10 ** (vv_db/10.0)
    vh_lin = 10 ** (vh_db/10.0)
    print("VV lin:", vv_lin, "VH lin:", vh_lin)
    print("VV/VH lin:", vv_lin / vh_lin)
    print("VH/VV lin:", vh_lin / vv_lin)
    print("VV-VH (dB):", vv_db - vh_db)
    print("VV/VH (dB / dB):", vv_db / vh_db)
