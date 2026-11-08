const fractions = {'¼':.25,'½':.5,'¾':.75,'⅓':1/3,'⅔':2/3,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};
const quantity = '(?:\\d+\\s+\\d+/\\d+|\\d+[¼½¾⅓⅔⅛⅜⅝⅞]|\\d+/\\d+|\\d+(?:\\.\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])';
const leading = new RegExp('^(\\s*(?:About\\s+)?)('+quantity+')(?:\\s*([-–])\\s*('+quantity+'))?(?=\\s|$)', 'i');
function value(s) {
  if (s in fractions) return fractions[s];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + +mixed[2]/+mixed[3];
  const unicode = s.match(/^(\d+)([¼½¾⅓⅔⅛⅜⅝⅞])$/);
  if (unicode) return +unicode[1]+fractions[unicode[2]];
  if (s.includes('/')) { const [a,b] = s.split('/'); return +a/+b; }
  return +s;
}
export function scaleIngredients(text, multiplier) {
  if (![.25,.5,1,2,3].includes(multiplier)) throw Error('Invalid recipe scale');
  if (multiplier === 1) return text;
  let ingredients = false;
  const format = q => String(Math.round(value(q)*multiplier*100)/100);
  return text.split('\n').map(line => {
    if (/^[A-Z][A-Z &/()–-]+$/.test(line.trim())) { ingredients = /INGREDIENT|^DRY MIX$|^CHICKEN MARINADE$|^OPTIONAL TOPPING$/.test(line); return line; }
    return ingredients ? line.replace(leading, (_,prefix,a,dash,b)=>prefix+format(a)+(b?dash+format(b):'')) : line;
  }).join('\n');
}
