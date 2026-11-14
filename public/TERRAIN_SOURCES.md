# Terrain data

NASA Scientific Visualization Studio, CGI Moon Kit: https://svs.gsfc.nasa.gov/4720/

moon-elevation.f32: lossless little-endian float32 conversion of ldem_4.tif (1440 × 720), kilometres relative to radius 1737.4 km. Source: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4.tif

moon.jpg: existing NASA LRO colour map. Regional sky terrain samples these maps at selected site coordinates. Elevation is bilinearly interpolated, without vertical exaggeration. Grid resolution is 0.25 degrees (~7.6 km north-south). This cannot resolve landing-scale hazards. The 300 km patch is visual; ephemeris metrics do not include terrain masking. The lower hemisphere remains a below-horizon fallback outside the patch.

moon-terrain-4k.jpg: JPEG conversion of the 2025 NASA LROC 4k colour map: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_4k.tif . Fine bump detail is procedurally generated for appearance and does not represent observed rocks or craters.
