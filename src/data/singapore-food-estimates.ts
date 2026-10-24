export type SingaporeIngredientBreakdown = {
  key: string;
  name: string;
  grams: number;
  fdcId: string | null;
};

export type SingaporeFoodEstimate = {
  id: string;
  name: string;
  brand: 'SG';
  servingQuantity: 1;
  servingUnit: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number;
  source: 'sg_estimate';
  sourceRef: string;
  ingredients: SingaporeIngredientBreakdown[];
};

type NutrientBasis = {
  name: string;
  fdcId: string | null;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
};

// Per-100 g edible portions selected from USDA FoodData Central Foundation Foods,
// SR Legacy and FNDDS. The composed dishes below are JIEN estimates, not official
// Singapore nutrient records. See docs/food-data.md for licence and methodology.
const INGREDIENTS = {
  rice: ['Rice, white, cooked', '168878', 2.7, 28.2, 0.3, 0.4],
  brownRice: ['Rice, brown, cooked', '168875', 2.7, 25.6, 1, 1.6],
  glutinousRice: ['Rice, glutinous, cooked', '2708364', 2, 21.1, 0.2, 1],
  riceNoodles: ['Rice noodles, cooked', '2708356', 1.8, 23.9, 0.2, 1],
  eggNoodles: ['Egg noodles, cooked', '172184', 4.5, 25.2, 2.1, 1.2],
  wheatNoodles: ['Wheat noodles, cooked', '2708374', 4.5, 27, 1.2, 1.8],
  vermicelli: ['Rice vermicelli, cooked', '2708356', 1.8, 23.9, 0.2, 1],
  chickenBreast: ['Chicken breast, roasted', '171077', 31, 0, 3.6, 0],
  chickenThigh: ['Chicken thigh, roasted', '171116', 24.8, 0, 8.2, 0],
  chickenWing: ['Chicken wing, roasted', '171123', 27, 0, 13.5, 0],
  duck: ['Duck, roasted, meat and skin', '172410', 19, 0, 28, 0],
  porkLean: ['Pork loin, cooked', '168251', 27.3, 0, 8.2, 0],
  porkBelly: ['Pork belly, cooked', '168260', 9.3, 0, 53, 0],
  charSiew: ['Pork, Chinese barbecue style', '2706098', 23, 12, 12, 0.4],
  beef: ['Beef, cooked, lean', '174032', 27, 0, 10, 0],
  mutton: ['Lamb, cooked, lean', '172498', 28, 0, 9, 0],
  fish: ['Fish, cooked, white flesh', '175167', 24, 0, 3, 0],
  shrimp: ['Shrimp, cooked', '175179', 24, 0.2, 0.3, 0],
  squid: ['Squid, cooked', '175168', 18, 7.8, 1.4, 0],
  tofu: ['Tofu, firm', '172475', 17.3, 2.8, 8.7, 2.3],
  egg: ['Egg, whole, cooked', '171287', 12.6, 1.1, 10.6, 0],
  coconutMilk: ['Coconut milk', '170172', 2.3, 5.5, 24, 2.2],
  oil: ['Vegetable oil', '172336', 0, 0, 100, 0],
  peanuts: ['Peanuts, roasted', '172430', 24.4, 21.3, 49.7, 8.4],
  anchovy: ['Anchovy, cooked', '175138', 29, 0, 10, 0],
  bread: ['White bread', '172686', 9, 49, 3.2, 2.7],
  kaya: ['Jams and preserves (kaya proxy)', '169641', 0.37, 68.86, 0.07, 1.1],
  butter: ['Butter', '173430', 0.9, 0.1, 81, 0],
  potato: ['Potato, boiled', '170438', 1.9, 20.1, 0.1, 1.8],
  sweetPotato: ['Sweet potato, cooked', '168483', 1.4, 20.7, 0.1, 3.3],
  carrot: ['Carrot, cooked', '170394', 0.8, 8.2, 0.2, 3],
  cabbage: ['Cabbage, cooked', '169977', 1.3, 5.5, 0.1, 1.9],
  bokChoy: ['Bok choy, cooked', '170391', 1.6, 2.2, 0.2, 1],
  beanSprouts: ['Mung bean sprouts', '169957', 3, 5.9, 0.2, 1.8],
  tomato: ['Tomato, cooked', '170502', 1, 4.8, 0.1, 1.5],
  cucumber: ['Cucumber, raw', '168409', 0.7, 3.6, 0.1, 0.5],
  onion: ['Onion, cooked', '170000', 1.4, 10.2, 0.2, 1.4],
  garlic: ['Garlic, raw', '169230', 6.4, 33.1, 0.5, 2.1],
  soySauce: ['Soy sauce', '174277', 8.1, 4.9, 0.6, 0.8],
  oysterSauce: ['Oyster sauce', '2706208', 1.4, 10.9, 0.3, 0.3],
  currySauce: ['Curry sauce', '2706188', 2, 9, 8, 1.5],
  sambal: ['Chilli sauce', '2706214', 1.5, 18, 6, 2],
  broth: ['Chicken broth', '171060', 0.6, 0.4, 0.2, 0],
  sugar: ['Sugar', '169655', 0, 100, 0, 0],
  condensedMilk: ['Sweetened condensed milk', '171275', 7.9, 54.4, 8.7, 0],
  evaporatedMilk: ['Evaporated milk', '171267', 6.8, 10, 7.6, 0],
  wholeMilk: ['Whole milk', '171265', 3.2, 4.7, 3.3, 0],
  coffee: ['Coffee, brewed', '171890', 0.1, 0.4, 0, 0],
  tea: ['Tea, brewed', '171918', 0, 0.3, 0, 0],
  maltPowder: ['Chocolate malted drink mix', '174866', 5.1, 86.94, 4.76, 4.8],
  flour: ['Wheat flour', '168936', 10.3, 76.3, 1, 2.7],
  banana: ['Banana', '173944', 1.1, 22.8, 0.3, 2.6],
  redBeans: ['Adzuki beans, cooked', '173727', 7.5, 24.8, 0.1, 7.3],
  chickpeas: ['Chickpeas, cooked', '173757', 8.9, 27.4, 2.6, 7.6],
  lentils: ['Lentils, cooked', '172421', 9, 20.1, 0.4, 7.9],
  fishCake: ['Fish cake', '2707429', 11, 12, 5, 0.5],
  fishBall: ['Fish ball', '2707430', 12, 10, 3, 0.4],
  sausage: ['Chicken sausage, cooked', '172967', 18, 2, 17, 0],
  luncheonMeat: ['Luncheon meat', '172956', 13, 2, 28, 0],
  cheese: ['Cheddar cheese', '173414', 23, 3.1, 33, 0],
  oats: ['Oats, dry', '173904', 13.2, 67.7, 6.5, 10.1],
  spinach: ['Spinach, cooked', '168463', 3, 3.8, 0.3, 2.4],
  mushrooms: ['Mushrooms, cooked', '169255', 3.6, 5.3, 0.4, 2.2],
  dough: ['Phyllo dough (wrapper/dough proxy)', '172791', 7.1, 52.6, 6, 1.9],
} satisfies Record<string, readonly [string, string | null, number, number, number, number]>;

type IngredientKey = keyof typeof INGREDIENTS;
type RecipeIngredient = readonly [IngredientKey, number];
type RecipeRow = readonly [string, string, string, readonly RecipeIngredient[]];

const recipes: RecipeRow[] = [
  // Rice dishes and porridge (45)
  ['chicken-rice-steamed', 'Chicken rice, steamed chicken', 'plate', [['rice', 220], ['chickenThigh', 120], ['oil', 8], ['cucumber', 35], ['soySauce', 15]]],
  ['chicken-rice-roasted', 'Chicken rice, roasted chicken', 'plate', [['rice', 220], ['chickenThigh', 130], ['oil', 10], ['cucumber', 35], ['soySauce', 15]]],
  ['chicken-rice-breast', 'Chicken rice, chicken breast', 'plate', [['rice', 220], ['chickenBreast', 125], ['oil', 8], ['cucumber', 35], ['soySauce', 15]]],
  ['chicken-rice-no-skin', 'Chicken rice, no skin', 'plate', [['rice', 220], ['chickenBreast', 120], ['oil', 5], ['cucumber', 35], ['soySauce', 15]]],
  ['duck-rice-roasted', 'Roast duck rice', 'plate', [['rice', 220], ['duck', 100], ['bokChoy', 60], ['soySauce', 18]]],
  ['duck-rice-braised', 'Braised duck rice', 'plate', [['rice', 220], ['duck', 95], ['tofu', 45], ['soySauce', 20]]],
  ['char-siew-rice', 'Char siew rice', 'plate', [['rice', 220], ['charSiew', 120], ['bokChoy', 55], ['oysterSauce', 15]]],
  ['roast-pork-rice', 'Roast pork rice', 'plate', [['rice', 220], ['porkBelly', 90], ['cucumber', 35], ['soySauce', 12]]],
  ['char-siew-roast-pork-rice', 'Char siew and roast pork rice', 'plate', [['rice', 220], ['charSiew', 65], ['porkBelly', 55], ['cucumber', 35]]],
  ['nasi-lemak-egg', 'Nasi lemak with egg', 'plate', [['rice', 190], ['coconutMilk', 35], ['egg', 55], ['peanuts', 20], ['anchovy', 15], ['sambal', 20], ['cucumber', 30]]],
  ['nasi-lemak-chicken-wing', 'Nasi lemak with chicken wing', 'plate', [['rice', 190], ['coconutMilk', 35], ['chickenWing', 95], ['peanuts', 18], ['anchovy', 12], ['sambal', 20], ['cucumber', 30]]],
  ['nasi-lemak-fish', 'Nasi lemak with fried fish', 'plate', [['rice', 190], ['coconutMilk', 35], ['fish', 110], ['oil', 8], ['peanuts', 18], ['anchovy', 12], ['sambal', 20]]],
  ['nasi-lemak-otah', 'Nasi lemak with otah', 'plate', [['rice', 190], ['coconutMilk', 35], ['fish', 85], ['coconutMilk', 15], ['sambal', 25], ['peanuts', 18], ['anchovy', 12]]],
  ['curry-chicken-rice', 'Curry chicken rice', 'plate', [['rice', 220], ['chickenThigh', 120], ['potato', 80], ['currySauce', 90]]],
  ['curry-fish-rice', 'Fish curry rice', 'plate', [['rice', 220], ['fish', 120], ['currySauce', 100], ['tomato', 40]]],
  ['hainanese-pork-chop-rice', 'Hainanese pork chop rice', 'plate', [['rice', 210], ['porkLean', 120], ['flour', 18], ['oil', 9], ['tomato', 70], ['onion', 35]]],
  ['claypot-chicken-rice', 'Claypot chicken rice', 'pot', [['rice', 230], ['chickenThigh', 120], ['sausage', 35], ['mushrooms', 35], ['soySauce', 18], ['oil', 6]]],
  ['black-pepper-beef-rice', 'Black pepper beef rice', 'plate', [['rice', 220], ['beef', 120], ['onion', 50], ['oysterSauce', 18], ['oil', 7]]],
  ['beef-rice-bowl', 'Beef rice bowl', 'bowl', [['rice', 220], ['beef', 115], ['onion', 55], ['soySauce', 18], ['oil', 5]]],
  ['salted-egg-chicken-rice', 'Salted egg chicken rice', 'plate', [['rice', 220], ['chickenThigh', 120], ['egg', 30], ['butter', 12], ['oil', 8]]],
  ['sambal-fish-rice', 'Sambal fish rice', 'plate', [['rice', 220], ['fish', 125], ['sambal', 35], ['oil', 7], ['cucumber', 35]]],
  ['tomato-egg-rice', 'Tomato egg rice', 'plate', [['rice', 220], ['egg', 110], ['tomato', 140], ['oil', 8], ['soySauce', 10]]],
  ['fried-rice-egg', 'Egg fried rice', 'plate', [['rice', 260], ['egg', 70], ['oil', 12], ['carrot', 35], ['soySauce', 14]]],
  ['fried-rice-chicken', 'Chicken fried rice', 'plate', [['rice', 250], ['chickenBreast', 90], ['egg', 45], ['oil', 12], ['carrot', 35], ['soySauce', 14]]],
  ['fried-rice-seafood', 'Seafood fried rice', 'plate', [['rice', 250], ['shrimp', 65], ['squid', 45], ['egg', 45], ['oil', 12], ['soySauce', 14]]],
  ['yangzhou-fried-rice', 'Yangzhou fried rice', 'plate', [['rice', 250], ['charSiew', 55], ['shrimp', 55], ['egg', 50], ['oil', 11], ['carrot', 35]]],
  ['brown-rice-chicken-bowl', 'Brown rice chicken bowl', 'bowl', [['brownRice', 230], ['chickenBreast', 120], ['bokChoy', 80], ['oil', 5], ['soySauce', 12]]],
  ['lei-cha-fan', 'Thunder tea rice (lei cha fan)', 'bowl', [['brownRice', 200], ['tofu', 65], ['peanuts', 22], ['bokChoy', 80], ['cabbage', 60], ['spinach', 60]]],
  ['yong-tau-foo-rice', 'Yong tau foo with rice', 'bowl', [['rice', 190], ['tofu', 100], ['fishCake', 75], ['bokChoy', 80], ['broth', 220]]],
  ['mui-fan-seafood', 'Seafood mui fan', 'plate', [['rice', 220], ['shrimp', 55], ['squid', 45], ['egg', 45], ['bokChoy', 65], ['oysterSauce', 20]]],
  ['mui-fan-chicken', 'Chicken mui fan', 'plate', [['rice', 220], ['chickenBreast', 100], ['egg', 45], ['bokChoy', 65], ['oysterSauce', 20]]],
  ['biryani-chicken', 'Chicken biryani', 'plate', [['rice', 260], ['chickenThigh', 145], ['oil', 12], ['currySauce', 45], ['onion', 35]]],
  ['biryani-mutton', 'Mutton biryani', 'plate', [['rice', 260], ['mutton', 140], ['oil', 12], ['currySauce', 45], ['onion', 35]]],
  ['biryani-fish', 'Fish biryani', 'plate', [['rice', 260], ['fish', 145], ['oil', 12], ['currySauce', 45], ['onion', 35]]],
  ['nasi-padang-chicken', 'Nasi padang with chicken', 'plate', [['rice', 220], ['chickenThigh', 120], ['currySauce', 60], ['cabbage', 80], ['sambal', 18]]],
  ['nasi-padang-beef', 'Nasi padang with beef rendang', 'plate', [['rice', 220], ['beef', 120], ['coconutMilk', 35], ['currySauce', 55], ['cabbage', 70]]],
  ['economy-rice-chicken-veg', 'Economy rice, chicken and vegetables', 'plate', [['rice', 220], ['chickenBreast', 100], ['cabbage', 90], ['oil', 8], ['oysterSauce', 15]]],
  ['economy-rice-fish-veg', 'Economy rice, fish and vegetables', 'plate', [['rice', 220], ['fish', 110], ['bokChoy', 90], ['oil', 8], ['oysterSauce', 15]]],
  ['economy-rice-tofu-veg', 'Economy rice, tofu and vegetables', 'plate', [['rice', 220], ['tofu', 120], ['cabbage', 90], ['oil', 8], ['oysterSauce', 15]]],
  ['lor-mai-gai', 'Lor mai gai', 'parcel', [['glutinousRice', 220], ['chickenThigh', 85], ['sausage', 30], ['mushrooms', 30], ['soySauce', 15]]],
  ['glutinous-rice', 'Savoury glutinous rice', 'bowl', [['glutinousRice', 220], ['porkLean', 55], ['mushrooms', 35], ['peanuts', 18], ['soySauce', 15]]],
  ['plain-porridge', 'Plain rice porridge', 'bowl', [['rice', 90], ['broth', 330]]],
  ['chicken-porridge', 'Chicken porridge', 'bowl', [['rice', 90], ['broth', 300], ['chickenBreast', 85], ['soySauce', 10]]],
  ['fish-porridge', 'Fish porridge', 'bowl', [['rice', 90], ['broth', 300], ['fish', 100], ['soySauce', 10]]],
  ['century-egg-pork-porridge', 'Century egg and pork porridge', 'bowl', [['rice', 90], ['broth', 300], ['porkLean', 70], ['egg', 55], ['soySauce', 10]]],

  // Noodles and soups (45)
  ['bak-chor-mee-dry', 'Bak chor mee, dry', 'bowl', [['eggNoodles', 220], ['porkLean', 85], ['mushrooms', 35], ['oil', 10], ['soySauce', 18], ['bokChoy', 45]]],
  ['bak-chor-mee-soup', 'Bak chor mee, soup', 'bowl', [['eggNoodles', 200], ['porkLean', 80], ['mushrooms', 35], ['broth', 280], ['bokChoy', 45]]],
  ['fishball-noodles-dry', 'Fishball noodles, dry', 'bowl', [['eggNoodles', 220], ['fishBall', 100], ['oil', 9], ['soySauce', 16], ['bokChoy', 45]]],
  ['fishball-noodles-soup', 'Fishball noodles, soup', 'bowl', [['eggNoodles', 190], ['fishBall', 100], ['broth', 300], ['bokChoy', 50]]],
  ['wanton-mee-dry', 'Wanton mee, dry', 'plate', [['eggNoodles', 220], ['charSiew', 75], ['shrimp', 35], ['dough', 35], ['oil', 9], ['soySauce', 16], ['bokChoy', 45]]],
  ['wanton-mee-soup', 'Wanton mee, soup', 'bowl', [['eggNoodles', 190], ['charSiew', 65], ['shrimp', 35], ['dough', 35], ['broth', 290], ['bokChoy', 45]]],
  ['char-kway-teow', 'Char kway teow', 'plate', [['riceNoodles', 250], ['egg', 55], ['shrimp', 55], ['sausage', 35], ['beanSprouts', 60], ['oil', 16], ['soySauce', 18]]],
  ['fried-hokkien-mee', 'Fried Hokkien mee', 'plate', [['eggNoodles', 150], ['riceNoodles', 110], ['shrimp', 65], ['squid', 45], ['egg', 45], ['broth', 80], ['oil', 12]]],
  ['mee-goreng', 'Mee goreng', 'plate', [['wheatNoodles', 250], ['egg', 55], ['tofu', 55], ['potato', 55], ['beanSprouts', 50], ['oil', 14], ['sambal', 25]]],
  ['mee-rebus', 'Mee rebus', 'bowl', [['eggNoodles', 220], ['potato', 100], ['egg', 55], ['tofu', 45], ['currySauce', 130], ['beanSprouts', 45]]],
  ['mee-siam', 'Mee siam', 'plate', [['vermicelli', 230], ['egg', 55], ['tofu', 55], ['beanSprouts', 55], ['sambal', 28], ['oil', 10]]],
  ['laksa', 'Katong laksa', 'bowl', [['riceNoodles', 220], ['coconutMilk', 95], ['shrimp', 55], ['fishCake', 65], ['egg', 45], ['beanSprouts', 45], ['sambal', 18]]],
  ['curry-chicken-noodles', 'Curry chicken noodles', 'bowl', [['eggNoodles', 210], ['chickenThigh', 110], ['potato', 65], ['currySauce', 110], ['coconutMilk', 45]]],
  ['prawn-noodles-dry', 'Prawn noodles, dry', 'bowl', [['eggNoodles', 220], ['shrimp', 100], ['porkLean', 45], ['oil', 9], ['soySauce', 16], ['beanSprouts', 45]]],
  ['prawn-noodles-soup', 'Prawn noodles, soup', 'bowl', [['eggNoodles', 190], ['shrimp', 100], ['porkLean', 40], ['broth', 300], ['beanSprouts', 45]]],
  ['lor-mee', 'Lor mee', 'bowl', [['wheatNoodles', 230], ['porkLean', 70], ['fishCake', 55], ['egg', 45], ['broth', 180], ['oysterSauce', 22]]],
  ['ban-mian-soup', 'Ban mian soup', 'bowl', [['wheatNoodles', 210], ['porkLean', 70], ['egg', 50], ['anchovy', 15], ['bokChoy', 55], ['broth', 300]]],
  ['you-mian-soup', 'You mian soup', 'bowl', [['wheatNoodles', 210], ['porkLean', 70], ['egg', 50], ['anchovy', 15], ['bokChoy', 55], ['broth', 300]]],
  ['mee-hoon-kway', 'Mee hoon kway soup', 'bowl', [['dough', 220], ['porkLean', 70], ['egg', 50], ['anchovy', 15], ['bokChoy', 55], ['broth', 300]]],
  ['beef-noodles-dry', 'Beef noodles, dry', 'bowl', [['riceNoodles', 220], ['beef', 115], ['oil', 8], ['soySauce', 16], ['bokChoy', 55]]],
  ['beef-noodles-soup', 'Beef noodles, soup', 'bowl', [['riceNoodles', 190], ['beef', 115], ['broth', 300], ['bokChoy', 55]]],
  ['duck-noodles-dry', 'Duck noodles, dry', 'bowl', [['eggNoodles', 220], ['duck', 95], ['oil', 7], ['soySauce', 16], ['bokChoy', 55]]],
  ['duck-noodles-soup', 'Duck noodles, soup', 'bowl', [['eggNoodles', 190], ['duck', 95], ['broth', 300], ['bokChoy', 55]]],
  ['fish-soup-noodles', 'Sliced fish soup noodles', 'bowl', [['riceNoodles', 170], ['fish', 120], ['broth', 330], ['tomato', 45], ['bokChoy', 60]]],
  ['fried-fish-soup-noodles', 'Fried fish soup noodles', 'bowl', [['riceNoodles', 170], ['fish', 120], ['flour', 16], ['oil', 10], ['broth', 330], ['bokChoy', 60]]],
  ['yong-tau-foo-noodles', 'Yong tau foo with noodles', 'bowl', [['riceNoodles', 170], ['tofu', 100], ['fishCake', 75], ['bokChoy', 75], ['broth', 260]]],
  ['kway-chap', 'Kway chap', 'bowl', [['riceNoodles', 190], ['porkBelly', 75], ['egg', 55], ['tofu', 70], ['broth', 240], ['soySauce', 18]]],
  ['chicken-macaroni-soup', 'Chicken macaroni soup', 'bowl', [['wheatNoodles', 190], ['chickenBreast', 90], ['broth', 300], ['carrot', 45], ['bokChoy', 45]]],
  ['satay-bee-hoon', 'Satay bee hoon', 'plate', [['vermicelli', 230], ['shrimp', 55], ['squid', 45], ['tofu', 55], ['peanuts', 45], ['sambal', 18]]],
  ['fried-bee-hoon', 'Fried bee hoon', 'plate', [['vermicelli', 250], ['egg', 45], ['cabbage', 70], ['carrot', 35], ['oil', 12], ['soySauce', 14]]],
  ['fried-bee-hoon-chicken', 'Fried bee hoon with chicken', 'plate', [['vermicelli', 240], ['chickenBreast', 90], ['egg', 45], ['cabbage', 65], ['oil', 12], ['soySauce', 14]]],
  ['fried-bee-hoon-fish', 'Fried bee hoon with fish', 'plate', [['vermicelli', 240], ['fish', 100], ['egg', 45], ['cabbage', 65], ['oil', 12], ['soySauce', 14]]],
  ['hor-fun-beef', 'Beef hor fun', 'plate', [['riceNoodles', 250], ['beef', 110], ['egg', 45], ['bokChoy', 65], ['oil', 12], ['oysterSauce', 22]]],
  ['hor-fun-seafood', 'Seafood hor fun', 'plate', [['riceNoodles', 250], ['shrimp', 60], ['squid', 50], ['egg', 45], ['bokChoy', 65], ['oil', 12], ['oysterSauce', 22]]],
  ['mee-pok-dry', 'Mee pok, dry', 'bowl', [['eggNoodles', 220], ['porkLean', 80], ['fishBall', 65], ['oil', 9], ['soySauce', 16], ['bokChoy', 45]]],
  ['mee-pok-soup', 'Mee pok, soup', 'bowl', [['eggNoodles', 190], ['porkLean', 75], ['fishBall', 65], ['broth', 300], ['bokChoy', 45]]],
  ['mee-kia-dry', 'Mee kia, dry', 'bowl', [['eggNoodles', 220], ['porkLean', 80], ['fishBall', 65], ['oil', 9], ['soySauce', 16], ['bokChoy', 45]]],
  ['mee-kia-soup', 'Mee kia, soup', 'bowl', [['eggNoodles', 190], ['porkLean', 75], ['fishBall', 65], ['broth', 300], ['bokChoy', 45]]],
  ['vegetarian-noodles', 'Vegetarian noodles', 'plate', [['eggNoodles', 230], ['tofu', 90], ['cabbage', 80], ['mushrooms', 45], ['oil', 10], ['soySauce', 14]]],
  ['fish-head-bee-hoon', 'Fish head bee hoon', 'bowl', [['vermicelli', 180], ['fish', 130], ['broth', 280], ['wholeMilk', 45], ['tomato', 45], ['bokChoy', 55]]],
  ['tom-yum-seafood-noodles', 'Tom yum seafood noodles', 'bowl', [['riceNoodles', 190], ['shrimp', 60], ['squid', 50], ['broth', 280], ['tomato', 55], ['mushrooms', 45]]],
  ['curry-fishball-noodles', 'Curry fishball noodles', 'bowl', [['eggNoodles', 200], ['fishBall', 105], ['currySauce', 110], ['coconutMilk', 40], ['bokChoy', 50]]],
  ['chicken-chop-noodles', 'Chicken chop noodles', 'plate', [['eggNoodles', 220], ['chickenThigh', 140], ['oil', 10], ['bokChoy', 55], ['soySauce', 15]]],
  ['mutton-noodle-soup', 'Mutton noodle soup', 'bowl', [['wheatNoodles', 190], ['mutton', 115], ['broth', 300], ['bokChoy', 55]]],
  ['soto-ayam-noodles', 'Mee soto ayam', 'bowl', [['wheatNoodles', 190], ['chickenBreast', 95], ['broth', 300], ['beanSprouts', 50], ['egg', 45]]],

  // Breakfast, snacks and sides (35)
  ['kaya-toast-set', 'Kaya toast with two eggs', 'set', [['bread', 80], ['kaya', 35], ['butter', 14], ['egg', 110]]],
  ['kaya-toast', 'Kaya butter toast', '2 slices', [['bread', 80], ['kaya', 35], ['butter', 14]]],
  ['peanut-toast', 'Peanut butter toast', '2 slices', [['bread', 80], ['peanuts', 30], ['butter', 8]]],
  ['soft-boiled-eggs', 'Soft-boiled eggs', '2 eggs', [['egg', 110], ['soySauce', 6]]],
  ['plain-prata', 'Roti prata, plain', 'piece', [['dough', 95], ['oil', 12]]],
  ['egg-prata', 'Roti prata, egg', 'piece', [['dough', 95], ['oil', 12], ['egg', 55]]],
  ['cheese-prata', 'Roti prata, cheese', 'piece', [['dough', 95], ['oil', 12], ['cheese', 35]]],
  ['banana-prata', 'Roti prata, banana', 'piece', [['dough', 95], ['oil', 12], ['banana', 80], ['sugar', 8]]],
  ['murtabak-chicken', 'Chicken murtabak', 'serving', [['dough', 150], ['chickenThigh', 105], ['egg', 70], ['onion', 50], ['oil', 14]]],
  ['murtabak-mutton', 'Mutton murtabak', 'serving', [['dough', 150], ['mutton', 105], ['egg', 70], ['onion', 50], ['oil', 14]]],
  ['chwee-kueh', 'Chwee kueh', '4 pieces', [['rice', 180], ['oil', 14], ['soySauce', 10]]],
  ['carrot-cake-white', 'Carrot cake, white', 'plate', [['rice', 210], ['egg', 75], ['oil', 14], ['soySauce', 12]]],
  ['carrot-cake-black', 'Carrot cake, black', 'plate', [['rice', 210], ['egg', 75], ['oil', 14], ['soySauce', 24], ['sugar', 10]]],
  ['cheong-fun-plain', 'Chee cheong fun, plain', 'plate', [['riceNoodles', 230], ['oil', 6], ['soySauce', 20], ['sugar', 6]]],
  ['cheong-fun-prawn', 'Chee cheong fun, prawn', 'plate', [['riceNoodles', 220], ['shrimp', 65], ['oil', 6], ['soySauce', 20]]],
  ['popiah', 'Popiah', 'roll', [['dough', 45], ['tofu', 35], ['cabbage', 80], ['carrot', 35], ['shrimp', 25], ['peanuts', 12]]],
  ['spring-roll', 'Fried spring roll', 'piece', [['dough', 45], ['cabbage', 45], ['carrot', 20], ['oil', 10]]],
  ['curry-puff-potato', 'Curry puff, potato', 'piece', [['dough', 65], ['potato', 65], ['currySauce', 18], ['oil', 8]]],
  ['curry-puff-chicken', 'Curry puff, chicken', 'piece', [['dough', 65], ['potato', 45], ['chickenThigh', 40], ['currySauce', 18], ['oil', 8]]],
  ['samosa-vegetable', 'Vegetable samosa', 'piece', [['dough', 55], ['potato', 55], ['carrot', 20], ['oil', 9]]],
  ['soon-kueh', 'Soon kueh', 'piece', [['riceNoodles', 65], ['cabbage', 45], ['carrot', 20], ['shrimp', 10], ['oil', 3]]],
  ['lor-bak', 'Ngoh hiang', 'serving', [['porkLean', 95], ['shrimp', 25], ['dough', 30], ['oil', 9]]],
  ['chicken-satay', 'Chicken satay', '10 sticks', [['chickenThigh', 180], ['peanuts', 35], ['sugar', 10], ['oil', 8], ['cucumber', 45], ['onion', 30]]],
  ['beef-satay', 'Beef satay', '10 sticks', [['beef', 180], ['peanuts', 35], ['sugar', 10], ['oil', 8], ['cucumber', 45], ['onion', 30]]],
  ['mutton-satay', 'Mutton satay', '10 sticks', [['mutton', 180], ['peanuts', 35], ['sugar', 10], ['oil', 8], ['cucumber', 45], ['onion', 30]]],
  ['otah', 'Otah', 'piece', [['fish', 75], ['coconutMilk', 18], ['sambal', 16]]],
  ['fried-chicken-wing', 'Fried chicken wing', 'wing', [['chickenWing', 95], ['flour', 12], ['oil', 9]]],
  ['fried-fish-cake', 'Fried fish cake', 'serving', [['fishCake', 120], ['oil', 9]]],
  ['fried-tofu', 'Fried tofu', 'serving', [['tofu', 130], ['oil', 10], ['soySauce', 10]]],
  ['tau-huay', 'Tau huay, soybean pudding', 'bowl', [['tofu', 160], ['sugar', 22]]],
  ['red-bean-soup', 'Red bean soup', 'bowl', [['redBeans', 150], ['sugar', 24]]],
  ['cheng-tng', 'Cheng tng', 'bowl', [['redBeans', 45], ['sugar', 24], ['sweetPotato', 45]]],
  ['ice-kachang', 'Ice kachang', 'bowl', [['redBeans', 65], ['condensedMilk', 25], ['sugar', 35], ['peanuts', 12]]],
  ['pulut-hitam', 'Pulut hitam', 'bowl', [['glutinousRice', 160], ['coconutMilk', 45], ['sugar', 28]]],
  ['goreng-pisang', 'Goreng pisang', 'piece', [['banana', 100], ['flour', 25], ['oil', 12], ['sugar', 5]]],

  // Kopitiam and hawker drinks (30)
  ['kopi-o-kosong', 'Kopi O kosong', 'cup', [['coffee', 220]]],
  ['kopi-o', 'Kopi O', 'cup', [['coffee', 220], ['sugar', 18]]],
  ['kopi-o-siew-dai', 'Kopi O siew dai', 'cup', [['coffee', 220], ['sugar', 9]]],
  ['kopi', 'Kopi', 'cup', [['coffee', 190], ['condensedMilk', 35], ['sugar', 8]]],
  ['kopi-siew-dai', 'Kopi siew dai', 'cup', [['coffee', 195], ['condensedMilk', 25], ['sugar', 4]]],
  ['kopi-c-kosong', 'Kopi C kosong', 'cup', [['coffee', 195], ['evaporatedMilk', 35]]],
  ['kopi-c', 'Kopi C', 'cup', [['coffee', 190], ['evaporatedMilk', 35], ['sugar', 16]]],
  ['kopi-c-siew-dai', 'Kopi C siew dai', 'cup', [['coffee', 195], ['evaporatedMilk', 35], ['sugar', 8]]],
  ['kopi-gao', 'Kopi gao', 'cup', [['coffee', 190], ['condensedMilk', 38], ['sugar', 8]]],
  ['kopi-peng', 'Kopi peng', 'cup', [['coffee', 210], ['condensedMilk', 38], ['sugar', 10]]],
  ['teh-o-kosong', 'Teh O kosong', 'cup', [['tea', 220]]],
  ['teh-o', 'Teh O', 'cup', [['tea', 220], ['sugar', 18]]],
  ['teh-o-siew-dai', 'Teh O siew dai', 'cup', [['tea', 220], ['sugar', 9]]],
  ['teh', 'Teh', 'cup', [['tea', 190], ['condensedMilk', 35], ['sugar', 8]]],
  ['teh-siew-dai', 'Teh siew dai', 'cup', [['tea', 195], ['condensedMilk', 25], ['sugar', 4]]],
  ['teh-c-kosong', 'Teh C kosong', 'cup', [['tea', 195], ['evaporatedMilk', 35]]],
  ['teh-c', 'Teh C', 'cup', [['tea', 190], ['evaporatedMilk', 35], ['sugar', 16]]],
  ['teh-c-siew-dai', 'Teh C siew dai', 'cup', [['tea', 195], ['evaporatedMilk', 35], ['sugar', 8]]],
  ['teh-tarik', 'Teh tarik', 'cup', [['tea', 180], ['condensedMilk', 45], ['sugar', 10]]],
  ['teh-peng', 'Teh peng', 'cup', [['tea', 210], ['condensedMilk', 38], ['sugar', 10]]],
  ['yuan-yang', 'Yuan yang', 'cup', [['coffee', 95], ['tea', 95], ['condensedMilk', 38], ['sugar', 9]]],
  ['milo-kosong', 'Milo kosong', 'cup', [['maltPowder', 28], ['wholeMilk', 160]]],
  ['milo', 'Milo', 'cup', [['maltPowder', 32], ['condensedMilk', 28], ['wholeMilk', 120]]],
  ['milo-peng', 'Milo peng', 'cup', [['maltPowder', 36], ['condensedMilk', 30], ['wholeMilk', 140]]],
  ['milo-dinosaur', 'Milo dinosaur', 'cup', [['maltPowder', 55], ['condensedMilk', 35], ['wholeMilk', 150]]],
  ['barley-drink', 'Barley drink', 'cup', [['oats', 18], ['sugar', 18]]],
  ['soy-milk-unsweetened', 'Soy milk, unsweetened', 'cup', [['tofu', 45], ['wholeMilk', 160]]],
  ['soy-milk-sweetened', 'Soy milk, sweetened', 'cup', [['tofu', 45], ['wholeMilk', 160], ['sugar', 16]]],
  ['lime-juice', 'Lime juice', 'cup', [['sugar', 24], ['cucumber', 15]]],
  ['bandung', 'Bandung rose milk', 'cup', [['wholeMilk', 180], ['condensedMilk', 30], ['sugar', 12]]],
];

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildEstimate([slug, name, servingUnit, recipe]: RecipeRow): SingaporeFoodEstimate {
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let fibre = 0;
  const ingredients = recipe.map(([key, grams]) => {
    const [ingredientName, fdcId, protein100, carbs100, fat100, fibre100] = INGREDIENTS[key];
    const factor = grams / 100;
    protein += protein100 * factor;
    carbs += carbs100 * factor;
    fat += fat100 * factor;
    fibre += fibre100 * factor;
    return { key, name: ingredientName, grams, fdcId };
  });
  protein = round(protein);
  carbs = round(carbs);
  fat = round(fat);
  fibre = round(fibre);
  return {
    id: `sg-estimate-${slug}`,
    name,
    brand: 'SG',
    servingQuantity: 1,
    servingUnit,
    caloriesKcal: Math.round((protein * 4) + (carbs * 4) + (fat * 9)),
    proteinG: protein,
    carbohydrateG: carbs,
    fatG: fat,
    fibreG: fibre,
    source: 'sg_estimate',
    sourceRef: `usda-fdc-recipe:${slug}`,
    ingredients,
  };
}

export const SINGAPORE_FOOD_ESTIMATES = recipes.map(buildEstimate);
