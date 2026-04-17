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

def get_ratio(img):
    vv = 10 ** (img.select('VV').divide(10))
    vh = 10 ** (img.select('VH').divide(10))
    ratio = vv.divide(vh).rename('ratio')
    return ratio

ratios = collection.map(get_ratio)
max_ratio = ratios.max().reduceRegion(reducer=ee.Reducer.mean(), geometry=geom, scale=10).getInfo()['ratio']
min_ratio = ratios.min().reduceRegion(reducer=ee.Reducer.mean(), geometry=geom, scale=10).getInfo()['ratio']

print("Max VV_lin/VH_lin:", max_ratio)
print("Min VV_lin/VH_lin:", min_ratio)

def get_db_ratio(img):
    return img.select('VV').subtract(img.select('VH')).rename('db_ratio')

db_ratios = collection.map(get_db_ratio)
max_db = db_ratios.max().reduceRegion(reducer=ee.Reducer.mean(), geometry=geom, scale=10).getInfo()['db_ratio']
min_db = db_ratios.min().reduceRegion(reducer=ee.Reducer.mean(), geometry=geom, scale=10).getInfo()['db_ratio']

print("Max VV-VH dB:", max_db)
print("Min VV-VH dB:", min_db)

