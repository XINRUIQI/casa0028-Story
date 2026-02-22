import { useState } from 'react';
import {Map, Source, Layer} from 'react-map-gl/maplibre';
import {plaqueData } from '../data/open-plaques-london-2023-11-10-filtered.js';
import 'maplibre-gl/dist/maplibre-gl.css';

function MapDisplay(props) {
  const plaqueLayerStyle = {
        id: 'plaques-layer',
        type: 'circle',
        source: 'plaques-data',
        paint: {
            'circle-radius': 6,
            'circle-color': '#007cbf',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        },
   }
   const handleMapClick = (event) => {
      const features = event.features;
      if (features.length) {
          const clickedFeature = features[0];
          console.log(clickedFeature.properties);
          console.log(clickedFeature.geometry);
      }
    }

  return (
    <Map
      initialViewState={{
        longitude: props.longitude,
        latitude: props.latitude,
        zoom: props.zoom
      }}
      style={{width: '100%', height: '100vh'}}
      mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      interactiveLayerIds={['plaques-layer']}
      onClick={handleMapClick}
   />

  ); 
}

export default MapDisplay;
