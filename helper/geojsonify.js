
const GeoJSON = require('geojson');
const extent = require('@mapbox/geojson-extent');
const logger = require('pelias-logger').get('geojsonify');
const addDetails = require('./geojsonify_place_details');
const _ = require('lodash');
const Document = require('pelias-model').Document;

function geojsonifyPlaces( params, docs ){

  // flatten & expand data for geojson conversion
  const geodata = docs
    .filter(doc => {
      if (!_.has(doc, 'center_point')) {
        logger.warn('No doc or center_point property');
        return false;
      } else {
        return true;
      }
    })
    .map(geojsonifyPlace.bind(null, params));

  // get all the bounding_box corners as well as single points
  // to be used for computing the overall bounding_box for the FeatureCollection
  const extentPoints = extractExtentPoints(geodata);

  // convert to geojson
  const geojson             = GeoJSON.parse( geodata, { Point: ['lat', 'lng'] });
  const geojsonExtentPoints = GeoJSON.parse( extentPoints, { Point: ['lat', 'lng'] });

  // to insert the bbox property at the top level of each feature, it must be done separately after
  // initial geojson construction is finished
  addBBoxPerFeature(geojson);

  // bounding box calculations
  computeBBox(geojson, geojsonExtentPoints);

  return geojson;
}

function geojsonifyPlace(params, place) {
  const output = {
    id: place._id,
    gid: new Document(place.source, place.layer, place._id).getGid(),
    layer: place.layer,
    source: place.source,
    source_id: place.source_id
  };

  if (place.hasOwnProperty('bounding_box')) {
    output.bounding_box = place.bounding_box;
  }

  addName(place, output);
  addDetails(params, place, output);

  // map center_point for GeoJSON to work properly
  // these should not show up in the final feature properties
  output.lat = parseFloat(place.center_point.lat);
  output.lng = parseFloat(place.center_point.lon);

  return output;
}

/**
 * Validate and add name property
 *
 * @param {object} src
 * @param {object} dst
 */
function addName(src, dst) {
  if (_.has(src, 'name.default')) {
    dst.name = src.name.default;
  } else {
    logger.warn(`doc ${dst.gid} does not contain name.default`);
  }
}

/**
 * Add bounding box
 *
 * @param {object} geojson
 */
function addBBoxPerFeature(geojson) {
  geojson.features.forEach(feature => {
    if (feature.properties.bounding_box) {
      feature.bbox = [
        feature.properties.bounding_box.min_lon,
        feature.properties.bounding_box.min_lat,
        feature.properties.bounding_box.max_lon,
        feature.properties.bounding_box.max_lat
      ];
    }

    delete feature.properties.bounding_box;
  });
}

/**
 * Collect all points from the geodata.
 * If an item is a single point, just use that.
 * If an item has a bounding box, add two corners of the box as individual points.
 *
 * @param {Array} geodata
 * @returns {Array}
 */
function extractExtentPoints(geodata) {
  return geodata.reduce((extentPoints, place) => {
    if (place.bounding_box) {
      extentPoints.push({
        lng: place.bounding_box.min_lon,
        lat: place.bounding_box.min_lat
      });
      extentPoints.push({
        lng: place.bounding_box.max_lon,
        lat: place.bounding_box.max_lat
      });

    }
    else {
      extentPoints.push({
        lng: place.lng,
        lat: place.lat
      });

    }
    return extentPoints;

  }, []);

}

/**
 * Compute bbox that encompasses all features in the result set.
 * Set bbox property on the geojson object.
 *
 * @param {object} geojson
 */
function computeBBox(geojson, geojsonExtentPoints) {
  // @note: extent() sometimes throws Errors for unusual data
  // eg: https://github.com/pelias/pelias/issues/84
  try {
    var bbox = extent( geojsonExtentPoints );
    if( !!bbox ){
      geojson.bbox = bbox;
    }
  } catch( e ){
    console.error( 'bbox error', e.message, e.stack );
    console.error( 'geojson', JSON.stringify( geojsonExtentPoints, null, 2 ) );
  }
}

module.exports = geojsonifyPlaces;
