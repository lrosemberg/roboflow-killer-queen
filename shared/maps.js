export const DEFAULT_MAP_ID = 'miami';

// One catalog drives room choices, renderer identities and future onsite maps.
// Availability is explicit: a preview is never enough to make a map playable.
export const MAP_CATALOG = Object.freeze(
  [
    {
      id: 'miami',
      name: 'Miami',
      subtitle: 'Sunset Circuit',
      kicker: 'PALMS. PIXELS. MAYHEM.',
      description: 'Art Deco rooftops, neon palms and a gator with somewhere to be.',
      accent: '#b58bff',
      preview: '/assets/maps/miami.svg',
      status: 'available',
      ride: { name: 'Gator', type: 'gator' },
      queen: { name: 'Sunset Queen', style: 'sunburst' },
    },
    {
      id: 'san-francisco',
      name: 'San Francisco',
      subtitle: 'Golden Gate Getaway',
      kicker: 'FOG. BRIDGES. BAD IDEAS.',
      description: 'Ride a cable car across bright rooftops, bridge towers and rolling fog.',
      accent: '#ed795e',
      preview: '/assets/maps/san-francisco.svg',
      status: 'available',
      ride: { name: 'Cable Car', type: 'cable-car' },
      queen: { name: 'Golden Gate Queen', style: 'bridge' },
    },
    {
      id: 'new-york',
      name: 'New York',
      subtitle: 'Skyline Scramble',
      kicker: 'BIG CITY. SMALL RACCOONS.',
      description: 'Climb skyscraper ledges while your crew takes the subway home.',
      accent: '#f1c84f',
      preview: '/assets/maps/new-york.svg',
      status: 'available',
      ride: { name: 'Subway', type: 'subway' },
      queen: { name: 'Liberty Queen', style: 'liberty' },
    },
    {
      id: 'brazil',
      name: 'Brazil',
      subtitle: 'Rio de Janeiro Rush',
      kicker: 'SUNSHINE. SAMBA. SIDE QUESTS.',
      description:
        'Cross Rio terraces on a delivery bike with an iFood backpack and carnival style.',
      accent: '#63bd78',
      preview: '/assets/maps/brazil.svg',
      status: 'available',
      ride: { name: 'Delivery Bike', type: 'delivery-bike' },
      queen: { name: 'Carnival Queen', style: 'carnival' },
    },
    {
      id: 'singapore',
      name: 'Singapore',
      subtitle: 'Neon Garden Run',
      kicker: 'GARDEN CITY. ARCADE ENERGY.',
      description: 'Hop through luminous sky gardens and bring a bumboat home along the river.',
      accent: '#63d2ce',
      preview: '/assets/maps/singapore.svg',
      status: 'available',
      ride: { name: 'Riverboat', type: 'bumboat' },
      queen: { name: 'Orchid Queen', style: 'orchid' },
    },
    {
      id: 'next-onsite',
      name: 'Next Onsite',
      subtitle: 'Coming soon',
      kicker: 'WHERE TO NEXT?',
      description: 'The next Roboflow adventure is still on the departure board.',
      accent: '#91a8a1',
      preview: '/assets/maps/next-onsite.svg',
      status: 'coming-soon',
      ride: { name: 'Mystery Ride', type: 'mystery' },
      queen: { name: 'Next Onsite Queen', style: 'mystery' },
    },
  ].map((entry) =>
    Object.freeze({ ...entry, ride: Object.freeze(entry.ride), queen: Object.freeze(entry.queen) }),
  ),
);

export const PLAYABLE_MAPS = Object.freeze(
  MAP_CATALOG.filter((entry) => entry.status === 'available'),
);
export const NEXT_MAP = MAP_CATALOG.find((entry) => entry.id === 'next-onsite');
export function isMapId(value) {
  return PLAYABLE_MAPS.some((entry) => entry.id === value);
}
export function normalizeMapId(value) {
  return isMapId(value) ? value : DEFAULT_MAP_ID;
}
export function getMapDefinition(value = DEFAULT_MAP_ID) {
  return PLAYABLE_MAPS.find((entry) => entry.id === normalizeMapId(value));
}
