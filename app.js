/*****************************************************************
 * Naamrot Converter - app.js
 * - Preserves whitespace/punctuation
 * - Transforms only word tokens: [A-Za-z]+ with internal - and '
 * - Output ALL CAPS
 *
 * Priority per word-part:
 *  1) Exceptions (first match wins)
 *  2) Suffix transforms
 *  3) Prefix transforms
 *  4) Consonant cluster insertions
 *  5) Vowel swaps (lowest priority)
 *****************************************************************/

/** Editable Exceptions (first match wins)
 * Supported:
 *  - { type:"literal", match:"word", out:"REPLACEMENT" }
 *  - { type:"regex", re:/^pattern$/i, out:"REPLACEMENT" }
 *  - { type:"regex", re:/^pattern$/i, out:(m,word)=>"..." }
 */
const EXCEPTIONS = [
  // Pronouns
  { type: "regex", re: /^(you|your)$/i, out: "YA" },

  // Function words
  { type: "regex", re: /^the$/i, out: "THA" },
  { type: "regex", re: /^for$/i, out: "FA" },

  // Forced pronunciation spellings
  { type: "regex", re: /^please$/i, out: "PALEASE" },
  { type: "regex", re: /^deadline$/i, out: "DODLINE" },
  { type: "regex", re: /^mistakes$/i, out: "MOSTAKES" },
    { type: "regex", re: /^aminur$/i, out: "AMINAH" },

  // Explicit keeps / overrides
  { type: "regex", re: /^date$/i, out: "DATE" }, // never touch
    { type: "regex", re: /^name$/i, out: "NAME" }, // never touch
  { type: "regex", re: /^set$/i, out: "SOT" },   // force vowel change
];



const PROTECTED_SUFFIXES = [
  "SHAN",
  "MENT","TION","ING","ED","ER","LY","NESS","ABLE","IBLE","OUS","IVE","AL","ITY"
].sort((a,b)=>b.length-a.length);

const WORD_TOKEN_RE = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g;

const VOWELS = new Set(["A","E","I","O","U"]);
const SWAPPABLE = new Set(["A","E","I"]); // U does not swap by default

function segFromString(str, origin=true){
  return Array.from(str).map(ch => ({ ch, origin }));
}
function segToString(segs){
  return segs.map(s => s.ch).join("");
}
function spliceSegs(segs, start, end, insertSegs){
  segs.splice(start, end-start, ...insertSegs);
  return segs;
}
function isLetter(ch){
  const c = ch.charCodeAt(0);
  return (c>=65 && c<=90) || (c>=97 && c<=122);
}
function isConsonantLetter(ch){
  const u = ch.toUpperCase();
  return isLetter(ch) && !VOWELS.has(u); // Y counts as consonant
}

/** Exceptions apply per word-part */
function applyExceptions(wordPart){
  for(const ex of EXCEPTIONS){
    if(ex?.type === "literal"){
      if(wordPart.toLowerCase() === String(ex.match ?? "").toLowerCase()){
        const out = (typeof ex.out === "function") ? ex.out(wordPart) : String(ex.out ?? "");
        return { hit:true, out };
      }
    } else if(ex?.type === "regex" && ex.re instanceof RegExp){
      const m = wordPart.match(ex.re);
      if(m){
        const out = (typeof ex.out === "function") ? ex.out(m, wordPart) : String(ex.out ?? "");
        return { hit:true, out };
      }
    }
  }
  return { hit:false, out: wordPart };
}

/** Find protected suffix boundary on current text */
function protectedSuffixStartIndex(segs){
  const upper = segToString(segs).toUpperCase();
  for(const suf of PROTECTED_SUFFIXES){
    if(upper.endsWith(suf)) return upper.length - suf.length;
  }
  return upper.length;
}

/** Track whether we changed the ending to AH (A/ER/UR only) */
function applyEndingAH(segs){
  const s = segToString(segs).toUpperCase();
  let changed = false;

  if (s.endsWith("ER") || s.endsWith("UR")) {
    spliceSegs(segs, segs.length - 2, segs.length, segFromString("AH", false));
    changed = true;
  } else if (s.endsWith("A")) {
    spliceSegs(segs, segs.length - 1, segs.length, segFromString("AH", false));
    changed = true;
  }

  return changed;
}

/** Replace ER -> AH anywhere (case-insensitive) (origin=false so vowel swaps can't touch it) */
function replaceAllERWithAH(segs){
  for(let i=0; i<segs.length-1; i++){
    const a = segs[i].ch.toUpperCase();
    const b = segs[i+1].ch.toUpperCase();
    if(a==="E" && b==="R"){
      spliceSegs(segs, i, i+2, segFromString("AH", false));
      i += 1;
    }
  }
  return segs;
}

function replaceEndingYToEH(segs){
  const s = segToString(segs).toUpperCase();

  // Skip cases already handled elsewhere
  if (s.endsWith("LY") || s.endsWith("LEY") || s.endsWith("TY")) {
    return false;
  }

  // Final Y -> EH (happy, academy, gypsy)
  if (s.endsWith("Y") && segs.length >= 1) {
    spliceSegs(segs, segs.length - 1, segs.length, segFromString("EH", false));
    return true;
  }

  return false;
}

/** If ends with LY -> LEH */
function replaceEndingLY(segs){
  const s = segToString(segs).toUpperCase();

  // -LEY -> -LEH (Burnley -> Burnleh)
  if (s.endsWith("LEY") && segs.length >= 3) {
    spliceSegs(segs, segs.length - 3, segs.length, segFromString("LEH", false));
    return segs;
  }

  // -LY -> -LEH (quickly -> quickleh)
  if (s.endsWith("LY") && segs.length >= 2) {
    spliceSegs(segs, segs.length - 2, segs.length, segFromString("LEH", false));
  }

  return segs;
}

function replaceEndingTY(segs){
  const s = segToString(segs).toUpperCase();
  if (s.endsWith("TY") && segs.length >= 2) {
    spliceSegs(segs, segs.length - 2, segs.length, segFromString("TEH", false));
    return true;
  }
  return false;
}


function replaceEndingTION(segs){
  const s = segToString(segs).toUpperCase();
  if (s.endsWith("TION") && segs.length >= 4) {
    spliceSegs(segs, segs.length - 4, segs.length, segFromString("SHAN", false));
    return true;
  }
  return false;
}

/** U “YOO” rule: if starts with U + [n s f t], U -> YAU */
function applyStartingUYoo(segs){
  if(segs.length >= 2){
    const first = segs[0].ch.toUpperCase();
    const next  = segs[1].ch.toUpperCase();
    if(first==="U" && ["N","S","F","T"].includes(next)){
      spliceSegs(segs, 0, 1, segFromString("YAU", false));
    }
  }
  return segs;
}

/** Conservative RE -> RO
 * - do NOT change if exactly "re"
 * - only if starts with re and 3rd char is a vowel
 */
function applyPrefixREToRO(segs){
  const s = segToString(segs);
  const lower = s.toLowerCase();
  if(lower === "re") return segs;

  if(lower.startsWith("re") && s.length >= 3){
    const third = s[2].toUpperCase();
    if(VOWELS.has(third)){
      spliceSegs(segs, 0, 2, segFromString("ro", false));
    }
  }
  return segs;
}

/** Cluster insertion rules (insert A origin=false)
 * 1) __R... (two consonants then R) => insert A after first two letters
 * 2) _R or _L => insert A after first letter
 */
function applyClusterInsertions(segs){
  if(segs.length >= 3){
    const c0 = segs[0].ch, c1 = segs[1].ch, c2 = segs[2].ch.toUpperCase();
    if(isConsonantLetter(c0) && isConsonantLetter(c1) && c2==="R"){
      spliceSegs(segs, 2, 2, segFromString("A", false));
      return segs;
    }
  }
  if(segs.length >= 2){
    const c0 = segs[0].ch, c1 = segs[1].ch.toUpperCase();
    if(isConsonantLetter(c0) && (c1==="R" || c1==="L")){
      spliceSegs(segs, 1, 1, segFromString("A", false));
    }
  }
  return segs;
}

/** Vowel swaps (lowest priority)
 * - swap A/E/I -> O
 * - never touch origin=false (inserted/replaced)
 * - never swap vowels inside protected suffix
 * - never swap a vowel that is part of a vowel digraph (next char is a vowel), e.g. EA in CLEAN
 * - IMPORTANT:
 *   - if ending was NOT changed to AH => do NOT swap the LAST vowel (ONTAHNET not ONTAHNOT)
 *   - if word-part has EXACTLY 4 vowels AND ending was NOT changed to AH => also protect LAST TWO vowels
 *     (GRAMMATICAL => GROMMOTICAL, not GROMMOTOCAL)
 */
function applyVowelSwaps(segs, endingChangedToAH){
  const boundary = protectedSuffixStartIndex(segs);

  // Collect vowel indices from ORIGINAL letters only (so inserted vowels don't affect the count)
  const origVowelIdx = [];
  for (let i = 0; i < segs.length; i++){
    if (!segs[i].origin) continue;
    const u = segs[i].ch.toUpperCase();
    if (VOWELS.has(u)) origVowelIdx.push(i);
  }

  // Which tail vowels should be protected?
  const protectSet = new Set();

  if (!endingChangedToAH && origVowelIdx.length >= 1) {
    // Always protect last vowel if ending didn't change
    protectSet.add(origVowelIdx[origVowelIdx.length - 1]);

    // If exactly 4 vowels, also protect the second last vowel
    if (origVowelIdx.length === 4) {
      protectSet.add(origVowelIdx[origVowelIdx.length - 2]);
    }
  }

  for(let i=0; i<segs.length; i++){
    if(i >= boundary) continue;
    if(!segs[i].origin) continue;

    const v = segs[i].ch.toUpperCase();
    if(!SWAPPABLE.has(v)) continue;

    // protect tail vowels (per your rule)
    if (protectSet.has(i)) continue;

    // protect vowel digraphs (EA, IA, etc.)
    const next = segs[i+1]?.ch?.toUpperCase() ?? "";
    if(VOWELS.has(next)) continue;

    // swap
    segs[i].ch = "o";
    segs[i].origin = false;
  }

  return segs;
}

/** Transform a single word-part (letters only) */
function transformWordPart(part){
  // 1) Exceptions
  const ex = applyExceptions(part);
  if(ex.hit) return String(ex.out).toUpperCase();

  let segs = segFromString(part, true);

  // 2) Suffix transforms
  segs = replaceAllERWithAH(segs);
  replaceEndingTION(segs);
  replaceEndingTY(segs);   
  segs = replaceEndingLY(segs);
  const endingChangedToAH = applyEndingAH(segs);
  replaceEndingYToEH(segs);

  // 3) Prefix transforms
  segs = applyStartingUYoo(segs);
  segs = applyPrefixREToRO(segs);

  // 4) Consonant cluster insertions
  segs = applyClusterInsertions(segs);

  // 5) Vowel swaps
  segs = applyVowelSwaps(segs, endingChangedToAH);

  return segToString(segs).toUpperCase();
}

/** Transform a token that may contain - and ' separators */
function transformWordToken(token){
  const parts = token.split(/([-'])/); // keep separators
  for(let i=0; i<parts.length; i++){
    if(parts[i] === "-" || parts[i] === "'") continue;
    parts[i] = transformWordPart(parts[i]);
  }
  return parts.join("");
}

/** Convert entire text, preserving whitespace + punctuation exactly */
function convertText(input){
  let out = "";
  let last = 0;

  for(const m of input.matchAll(WORD_TOKEN_RE)){
    out += input.slice(last, m.index);
    out += transformWordToken(m[0]);
    last = m.index + m[0].length;
  }
  out += input.slice(last);

  return out.toUpperCase();
}

/** UI */
const $ = (id) => document.getElementById(id);
const inputEl  = $("input");
const outEl    = $("output");
const statusEl = $("status");

function setStatus(text){ statusEl.textContent = text; }

function doConvert(){
  outEl.textContent = convertText(inputEl.value ?? "");
  setStatus("CONVERTED");
  clearTimeout(doConvert._t);
  doConvert._t = setTimeout(()=>setStatus("READY"), 900);
}

$("convert").addEventListener("click", doConvert);

inputEl.addEventListener("keydown", (e)=>{
  if((e.ctrlKey || e.metaKey) && e.key === "Enter"){
    e.preventDefault();
    doConvert();
  }
});

$("clear").addEventListener("click", ()=>{
  inputEl.value = "";
  outEl.textContent = "";
  setStatus("READY");
  inputEl.focus();
});

$("copy").addEventListener("click", async ()=>{
  try{
    await navigator.clipboard.writeText(outEl.textContent ?? "");
    setStatus("COPIED");
    clearTimeout($("copy")._t);
    $("copy")._t = setTimeout(()=>setStatus("READY"), 900);
  }catch{
    setStatus("COPY FAILED");
    setTimeout(()=>setStatus("READY"), 1200);
  }
});

// Optional demo seed
inputEl.value =
``;

doConvert();
