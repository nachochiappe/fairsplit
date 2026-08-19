export const CATEGORY_ICON_KEYS = [
  'home',
  'cart',
  'car',
  'wallet',
  'sparkles',
  'dots',
  'utensils',
  'plane',
  'gift',
  'paw',
  'heart',
  'medical',
  'graduation',
  'briefcase',
  'tools',
  'wifi',
  'shirt',
  'dumbbell',
  'baby',
  'gamepad',
  'receipt',
  'coffee',
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

const ICON_KEYWORDS: ReadonlyArray<{
  icon: CategoryIconKey;
  keywords: readonly string[];
}> = [
  { icon: 'wifi', keywords: ['internet', 'wifi', 'broadband', 'telefono', 'phone'] },
  {
    icon: 'home',
    keywords: ['alquiler', 'casa', 'hogar', 'home', 'house', 'housing', 'mortgage', 'rent'],
  },
  {
    icon: 'cart',
    keywords: ['essential', 'grocer', 'market', 'mercado', 'shop', 'super', 'supermercado'],
  },
  {
    icon: 'car',
    keywords: [
      'auto',
      'bus',
      'cabify',
      'car',
      'combustible',
      'fuel',
      'mobility',
      'movilidad',
      'nafta',
      'parking',
      'taxi',
      'train',
      'transport',
      'uber',
    ],
  },
  {
    icon: 'wallet',
    keywords: [
      'bank',
      'banco',
      'credit',
      'credito',
      'debt',
      'finance',
      'finanza',
      'impuesto',
      'investment',
      'loan',
      'money',
      'seguro',
      'tax',
    ],
  },
  {
    icon: 'utensils',
    keywords: ['comida', 'delivery', 'dinner', 'food', 'lunch', 'restaurant', 'restaurante'],
  },
  {
    icon: 'plane',
    keywords: ['flight', 'hotel', 'trip', 'travel', 'vacacion', 'viaje', 'vuelo'],
  },
  { icon: 'gift', keywords: ['birthday', 'cumple', 'gift', 'regalo'] },
  {
    icon: 'paw',
    keywords: ['cat', 'dog', 'gatita', 'gato', 'mascota', 'perro', 'pet', 'veterinaria', 'vet'],
  },
  { icon: 'heart', keywords: ['donation', 'family', 'familia', 'love', 'pareja'] },
  {
    icon: 'medical',
    keywords: ['doctor', 'farmacia', 'health', 'medical', 'medico', 'pharmacy', 'salud'],
  },
  {
    icon: 'graduation',
    keywords: ['book', 'college', 'education', 'escuela', 'school', 'study', 'universidad'],
  },
  { icon: 'briefcase', keywords: ['business', 'empresa', 'office', 'trabajo', 'work'] },
  {
    icon: 'tools',
    keywords: ['cleaning', 'garden', 'jardin', 'limpieza', 'maintenance', 'repair', 'service'],
  },
  { icon: 'shirt', keywords: ['clothes', 'clothing', 'ropa', 'shirt', 'zapato'] },
  {
    icon: 'dumbbell',
    keywords: ['deporte', 'fitness', 'gym', 'gimnasio', 'sport', 'training'],
  },
  { icon: 'baby', keywords: ['baby', 'bebe', 'child', 'hijo', 'kid', 'nino'] },
  {
    icon: 'gamepad',
    keywords: ['entertainment', 'game', 'gaming', 'juego', 'streaming', 'videojuego'],
  },
  { icon: 'coffee', keywords: ['cafe', 'coffee', 'merienda'] },
  {
    icon: 'sparkles',
    keywords: ['diversion', 'fun', 'lifestyle', 'ocio', 'salida', 'subscription'],
  },
];

function normalizeWords(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function matchesKeyword(word: string, keyword: string): boolean {
  return word === keyword || (keyword.length >= 4 && word.startsWith(keyword));
}

export function isCategoryIconKey(value: unknown): value is CategoryIconKey {
  return typeof value === 'string' && CATEGORY_ICON_KEYS.includes(value as CategoryIconKey);
}

export function inferCategoryIcon(name: string): CategoryIconKey {
  const words = normalizeWords(name);

  for (const entry of ICON_KEYWORDS) {
    if (words.some((word) => entry.keywords.some((keyword) => matchesKeyword(word, keyword)))) {
      return entry.icon;
    }
  }

  return 'receipt';
}

export function resolveCategoryIcon(icon: unknown, name: string): CategoryIconKey {
  return isCategoryIconKey(icon) ? icon : inferCategoryIcon(name);
}
