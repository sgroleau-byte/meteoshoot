import React from 'react';

// ===== CONSTANTS =====
export const MandateType = { INT: 'INT', EXT: 'EXT', DRONE: 'DRONE', DRONE_C: 'DRONE+C', VID: 'VID' };
export const renderMandate = (m, baseColor) => m === 'DRONE+C' ? React.createElement('span', null, React.createElement('span', {style:{color:baseColor}}, 'DRONE.'), React.createElement('span', {style:{color: baseColor === '#404A48' ? '#404A48' : '#d83152'}}, 'C')) : React.createElement('span', {style:{color:baseColor}}, m);
export const ProjectStatus = { TODO: 'todo', RETOUCHING: 'retouching', DONE: 'done' };
