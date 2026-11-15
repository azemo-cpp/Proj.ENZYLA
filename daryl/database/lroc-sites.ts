/* Mga site mula sa LROC Featured Sites (https://lroc.im-ldi.com/featured_sites), 33 sa 38.
Mga coordinate: NASA NSSDC (lunar_sites at lunar_artifact_impacts), planetocentric, N/E positive.
Ang longitude na nasa 0-360 East ay ginawang -180..180. Ang mga Apollo ay ang Lunar Module.
Blue Ghost 1: 18.5623 N, 61.8103 E (aktwal na landing, mula sa LRO imagery; hindi galing sa NSSDC, i-verify kung kailangan).
Wala pang beripikadong coordinate, kaya wala dito: IM2, 17 March 2013 Event, New Crater 260, 278, 572.
Nauuna ang anim na Apollo (11, 12, 14, 15, 16, 17) para tumugma ang index nila sa mga tab ng page. */
export const APOLLO_SITES = [
  { id: 'apollo-11', name: 'Apollo 11', lat: 0.67416, lon: 23.4731, description: 'Apollo Landing Sites. LROC views: Temporal Traverse, Simple Traverse, Flip Book.' },
  { id: 'apollo-12', name: 'Apollo 12', lat: -3.0128, lon: -23.4219, description: 'Apollo Landing Sites. LROC views: Temporal Traverse, Simple Traverse, Flip Book.' },
  { id: 'apollo-14', name: 'Apollo 14', lat: -3.64589, lon: -17.4719, description: 'Apollo Landing Sites. LROC views: Temporal Traverse, Simple Traverse, Flip Book.' },
  { id: 'apollo-15', name: 'Apollo 15', lat: 26.13239, lon: 3.6333, description: 'Apollo Landing Sites. LROC views: Temporal Traverse, Simple Traverse, Flip Book.' },
  { id: 'apollo-16', name: 'Apollo 16', lat: -8.9734, lon: 15.5011, description: 'Apollo Landing Sites. LROC views: Temporal Traverse, Simple Traverse, Flip Book.' },
  { id: 'apollo-17', name: 'Apollo 17', lat: 20.1911, lon: 30.7723, description: 'Apollo Landing Sites. LROC views: Temporal Traverse, Simple Traverse, Flip Book.' },
  { id: 'grail-a', name: 'GRAIL A', lat: 75.6088, lon: -26.594, description: '21st Century Spacecraft Impacts. LROC views: Before/After.' },
  { id: 'grail-b', name: 'GRAIL B', lat: 75.6508, lon: -26.8341, description: '21st Century Spacecraft Impacts. LROC views: Before/After.' },
  { id: 'ladee', name: 'LADEE', lat: 11.8494, lon: -93.2494, description: '21st Century Spacecraft Impacts. LROC views: Before/After.' },
  { id: 'chang-e-3-landing-site', name: 'Chang\'e 3 Landing Site', lat: 44.1214, lon: -19.5117, description: '21st Century Landing Sites. LROC views: Flip Book.' },
  { id: 'chang-e-4-landing-site', name: 'Chang\'e 4 Landing Site', lat: -45.4561, lon: 177.5885, description: '21st Century Landing Sites. LROC views: Zoomable Traverse, Flip Book.' },
  { id: 'blue-ghost-1', name: 'Blue Ghost 1', lat: 18.5623, lon: 61.8103, description: '21st Century Landing Sites. LROC views: Flip Book.' },
  { id: 'apollo-13-s-ivb', name: 'Apollo 13 S-IVB', lat: -2.555, lon: -27.8875, description: 'Apollo S-IVB Impact Sites. LROC views: Flip Book.' },
  { id: 'apollo-14-s-ivb', name: 'Apollo 14 S-IVB', lat: -8.181, lon: -26.0305, description: 'Apollo S-IVB Impact Sites. LROC views: Flip Book.' },
  { id: 'apollo-15-s-ivb', name: 'Apollo 15 S-IVB', lat: -1.2897, lon: -11.8245, description: 'Apollo S-IVB Impact Sites. LROC views: Flip Book.' },
  { id: 'apollo-17-s-ivb', name: 'Apollo 17 S-IVB', lat: -4.1681, lon: -12.3307, description: 'Apollo S-IVB Impact Sites. LROC views: Flip Book.' },
  { id: 'surveyor-1', name: 'Surveyor 1', lat: -2.4745, lon: -43.3398, description: 'Surveyor Landing Sites. LROC views: Flip Book.' },
  { id: 'surveyor-3', name: 'Surveyor 3', lat: -3.0162, lon: -23.418, description: 'Surveyor Landing Sites. LROC views: Flip Book.' },
  { id: 'surveyor-5', name: 'Surveyor 5', lat: 1.4551, lon: 23.1943, description: 'Surveyor Landing Sites. LROC views: Flip Book.' },
  { id: 'surveyor-6', name: 'Surveyor 6', lat: 0.4742, lon: -1.4275, description: 'Surveyor Landing Sites. LROC views: Flip Book.' },
  { id: 'surveyor-7', name: 'Surveyor 7', lat: -40.9812, lon: -11.5127, description: 'Surveyor Landing Sites. LROC views: Flip Book.' },
  { id: 'ranger-6', name: 'Ranger 6', lat: 9.3864, lon: 21.4806, description: 'Ranger Impact Sites. LROC views: Flip Book.' },
  { id: 'ranger-7', name: 'Ranger 7', lat: -10.634, lon: -20.677, description: 'Ranger Impact Sites. LROC views: Flip Book.' },
  { id: 'ranger-8', name: 'Ranger 8', lat: 2.6376, lon: 24.7881, description: 'Ranger Impact Sites. LROC views: Flip Book.' },
  { id: 'ranger-9', name: 'Ranger 9', lat: -12.8281, lon: -2.3884, description: 'Ranger Impact Sites. LROC views: Flip Book.' },
  { id: 'luna-16', name: 'Luna 16', lat: -0.5137, lon: 56.3638, description: 'Luna Landing Sites. LROC views: Flip Book.' },
  { id: 'luna-17', name: 'Luna 17', lat: 38.23764, lon: -35.0016, description: 'Luna Landing Sites. LROC views: Flip Book.' },
  { id: 'luna-20', name: 'Luna 20', lat: 3.7863, lon: 56.6242, description: 'Luna Landing Sites. LROC views: Flip Book.' },
  { id: 'luna-21', name: 'Luna 21', lat: 25.9994, lon: 30.4076, description: 'Luna Landing Sites. LROC views: Flip Book.' },
  { id: 'luna-23', name: 'Luna 23', lat: 12.6667, lon: 62.1511, description: 'Luna Landing Sites. LROC views: Flip Book.' },
  { id: 'luna-24', name: 'Luna 24', lat: 12.7142, lon: 62.2129, description: 'Luna Landing Sites. LROC views: Flip Book.' },
  { id: 'lunokhod-1', name: 'Lunokhod 1', lat: 38.315, lon: -35.0081, description: 'Lunokhod Rover Sites. LROC views: Zoomable Traverse, Flip Book.' },
  { id: 'lunokhod-2', name: 'Lunokhod 2', lat: 25.8323, lon: 30.9222, description: 'Lunokhod Rover Sites. LROC views: Zoomable Traverse, Flip Book.' },
];
