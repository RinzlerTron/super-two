// One night out, in New York or Singapore. This file holds only our own data: names to look up,
// venue coordinates and the show lineup. Qloo ids are resolved at start-up and
// kept in memory (Qloo data is never committed).
//
// The lineup is a sample: these artists are not booked at these venues on a
// real date. The page says so. Restaurants and bars come live from Qloo.

export interface City {
  key: string;
  name: string; // shown on the page
  line: string; // one line under the name
  photo: string; // Qloo place whose photo stands for the city (exact name)
}

export const CITIES: City[] = [
  { key: "nyc", name: "New York", line: "From Radio City to Brooklyn Steel", photo: "Brooklyn Bridge" },
  { key: "sg", name: "Singapore", line: "From the Esplanade to Sentosa", photo: "Esplanade - Theatres on the Bay, Singapore" },
];

export interface Venue {
  key: string;
  city: string;
  name: string;
  lat: number;
  lon: number;
  area: string;
}

export interface Show {
  key: string;
  artist: string;
  venue: Record<string, string>; // city key -> Venue.key
}

export const VENUES: Venue[] = [
  { key: "radio-city", city: "nyc", name: "Radio City Music Hall", lat: 40.76, lon: -73.98, area: "Midtown" },
  { key: "blue-note", city: "nyc", name: "Blue Note", lat: 40.7307, lon: -74.0007, area: "Greenwich Village" },
  { key: "brooklyn-steel", city: "nyc", name: "Brooklyn Steel", lat: 40.7193, lon: -73.9389, area: "East Williamsburg" },
  { key: "barclays", city: "nyc", name: "Barclays Center", lat: 40.6826, lon: -73.9754, area: "Prospect Heights" },
  { key: "msg", city: "nyc", name: "Madison Square Garden", lat: 40.7505, lon: -73.9934, area: "Midtown" },
  { key: "terminal-5", city: "nyc", name: "Terminal 5", lat: 40.7697, lon: -73.9928, area: "Hell's Kitchen" },
  { key: "jalc", city: "nyc", name: "Jazz at Lincoln Center", lat: 40.7685, lon: -73.9829, area: "Columbus Circle" },
  { key: "beacon", city: "nyc", name: "Beacon Theatre", lat: 40.7805, lon: -73.9812, area: "Upper West Side" },
  { key: "kings", city: "nyc", name: "Kings Theatre", lat: 40.6461, lon: -73.9575, area: "Flatbush" },
  { key: "paramount", city: "nyc", name: "Brooklyn Paramount", lat: 40.6904, lon: -73.9831, area: "Downtown Brooklyn" },
  { key: "bowery", city: "nyc", name: "Bowery Ballroom", lat: 40.7204, lon: -73.9934, area: "Lower East Side" },
  { key: "webster", city: "nyc", name: "Webster Hall", lat: 40.7318, lon: -73.989, area: "East Village" },
  { key: "apollo", city: "nyc", name: "Apollo Theater", lat: 40.81, lon: -73.95, area: "Harlem" },
  { key: "esplanade", city: "sg", name: "Esplanade Concert Hall", lat: 1.2897, lon: 103.8559, area: "Marina Bay" },
  { key: "victoria", city: "sg", name: "Victoria Theatre", lat: 1.288, lon: 103.8516, area: "Civic District" },
  { key: "capitol", city: "sg", name: "Capitol Theatre", lat: 1.293, lon: 103.851, area: "City Hall" },
  { key: "indoor-stadium", city: "sg", name: "Singapore Indoor Stadium", lat: 1.3006, lon: 103.8745, area: "Kallang" },
  { key: "national-stadium", city: "sg", name: "National Stadium", lat: 1.304, lon: 103.8743, area: "Kallang" },
  { key: "star", city: "sg", name: "The Star Theatre", lat: 1.3071, lon: 103.788, area: "Buona Vista" },
  { key: "sands", city: "sg", name: "Sands Theatre", lat: 1.2834, lon: 103.8591, area: "Marina Bay Sands" },
  { key: "power-station", city: "sg", name: "Pasir Panjang Power Station", lat: 1.2772, lon: 103.8007, area: "Pasir Panjang" },
  { key: "coliseum", city: "sg", name: "The Coliseum", lat: 1.2542, lon: 103.8203, area: "Sentosa" },
  { key: "gateway", city: "sg", name: "Gateway Theatre", lat: 1.3308, lon: 103.8695, area: "Toa Payoh" },
];

export const SHOWS: Show[] = [
  { key: "bon-iver", artist: "Bon Iver", venue: { nyc: "radio-city", sg: "esplanade" } },
  { key: "norah-jones", artist: "Norah Jones", venue: { nyc: "blue-note", sg: "victoria" } },
  { key: "phoebe-bridgers", artist: "Phoebe Bridgers", venue: { nyc: "brooklyn-steel", sg: "capitol" } },
  { key: "kendrick-lamar", artist: "Kendrick Lamar", venue: { nyc: "barclays", sg: "national-stadium" } },
  { key: "billy-joel", artist: "Billy Joel", venue: { nyc: "msg", sg: "indoor-stadium" } },
  { key: "lcd-soundsystem", artist: "LCD Soundsystem", venue: { nyc: "terminal-5", sg: "power-station" } },
  { key: "wynton-marsalis", artist: "Wynton Marsalis", venue: { nyc: "jalc", sg: "esplanade" } },
  { key: "mitski", artist: "Mitski", venue: { nyc: "beacon", sg: "star" } },
  { key: "cigarettes-after-sex", artist: "Cigarettes After Sex", venue: { nyc: "kings", sg: "gateway" } },
  { key: "fred-again", artist: "Fred again..", venue: { nyc: "paramount", sg: "coliseum" } },
  { key: "vampire-weekend", artist: "Vampire Weekend", venue: { nyc: "bowery", sg: "capitol" } },
  { key: "bad-bunny", artist: "Bad Bunny", venue: { nyc: "msg", sg: "national-stadium" } },
  { key: "the-strokes", artist: "The Strokes", venue: { nyc: "webster", sg: "indoor-stadium" } },
  { key: "lauryn-hill", artist: "Lauryn Hill", venue: { nyc: "apollo", sg: "sands" } },
  { key: "zach-bryan", artist: "Zach Bryan", venue: { nyc: "barclays", sg: "star" } },
  { key: "peso-pluma", artist: "Peso Pluma", venue: { nyc: "barclays", sg: "coliseum" } },
];

// The opening taste rounds: one of two, across domains, so the twin has a
// profile before it picks a show. Each side is looked up by exact name.
export interface SeedSide {
  name: string;
  type: string;
  note: string;
  focus?: string; // CSS object-position when Qloo's photo needs a different crop
  logo?: boolean; // Qloo's image is a brand mark: show it whole, not cropped
}

export const SEED_ROUNDS: [SeedSide, SeedSide][] = [
  [
    { name: "Radiohead", type: "urn:entity:artist", note: "Music", focus: "center 92%" }, // Qloo's photo is a band strip under an empty grey band
    { name: "Drake", type: "urn:entity:artist", note: "Music" },
  ],
  [
    { name: "Moonlight", type: "urn:entity:movie", note: "Film" },
    { name: "Top Gun: Maverick", type: "urn:entity:movie", note: "Film" },
  ],
  [
    { name: "Patagonia", type: "urn:entity:brand", note: "Wardrobe", logo: true },
    { name: "Gucci", type: "urn:entity:brand", note: "Wardrobe", logo: true },
  ],
  [
    { name: "The Bear", type: "urn:entity:tv_show", note: "Television" },
    { name: "Love Island", type: "urn:entity:tv_show", note: "Television" },
  ],
];

export const TAG_RESTAURANT = "urn:tag:category:place:restaurant";
export const TAG_BAR = "urn:tag:category:place:cocktail_bar";
export const TAG_ANY_BAR = "urn:tag:category:place:bar";

export function venueByKey(key: string): Venue {
  const v = VENUES.find((x) => x.key === key);
  if (!v) throw new Error(`unknown venue ${key}`);
  return v;
}
