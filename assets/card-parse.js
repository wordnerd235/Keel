// Turn OCR'd business card lines into Card File's fields. Rules, not AI:
//   emails, websites and phones by pattern (phone labels from the card's own markers: M, C, O, T, F, ...),
//   a US address from the "City, ST 12345" line and the street line above it,
//   then name (largest print, looks like a person's name), title (job words) and company (business words
//   or the email's domain). Whatever is left goes to "other". Text is kept as printed.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|biz|info|us|co|io|edu|gov|ai|app|dev|me|tv|ca|uk|law|health|realty|example)(?:\/[^\s]*)?)\b/gi;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;
const CITY_LINE = /^(.*?)[,\s]+([A-Z]{2})\.?\s+(\d{5}(?:-\d{4})?)\s*$/;
const STREET = /^\d{1,6}\s*[A-Za-z]/;
const UNIT = /^(suite|ste\.?|unit|apt\.?|building|bldg\.?|floor|fl\.?|room|rm\.?|#|p\.?\s?o\.?\s+box)\b/i;
const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));
const TITLE_WORDS = /\b(manager|director|president|vice|vp|ceo|cfo|coo|cto|cio|chief|officer|owner|founder|co-founder|partner|principal|associate|engineer|technician|specialist|consultant|advisor|adviser|analyst|coordinator|supervisor|administrator|assistant|executive|representative|rep|agent|broker|realtor|architect|designer|developer|attorney|lawyer|counsel|accountant|cpa|dds|dmd|md|rn|np|pa-c|doctor|dr\.|nurse|therapist|pastor|teacher|professor|sales|account|marketing|operations|service|support|lead|head|senior|sr\.|junior|jr\.|estimator|inspector|contractor|electrician|plumber|mechanic|foreman|superintendent|planner|recruiter|dealer|underwriter|loan|mortgage|insurance)\b/i;
const COMPANY_WORDS = /(\binc\b\.?|\bllc\b|\bl\.l\.c\.|\bltd\b|\bco\.|\bcorp\b|\bcorporation\b|\bcompany\b|\bgroup\b|\bassociates\b|\bpartners\b|\bservices\b|\bsolutions\b|\bsystems\b|\btechnologies\b|\benterprises\b|\bindustries\b|\bholdings\b|\bbank\b|\bcredit union\b|\bclinic\b|\bhospital\b|\bdental\b|\brealty\b|\breal estate\b|\binsurance\b|\bconstruction\b|\bplumbing\b|\belectric\b|\bheating\b|\bauto\b|\bmotors\b|\bchurch\b|\buniversity\b|\bcollege\b|\bschool\b|\bfirm\b|\blaw\b|\bpllc\b|\bpc\b| & )/i;

const LABELS = [
  [/\b(m|mob|mobile|c|cell|cellular)\b\.?\s*:?\s*$/i, "mobile"],
  [/\b(f|fax)\b\.?\s*:?\s*$/i, "fax"],
  [/\b(o|off|office|main)\b\.?\s*:?\s*$/i, "office"],
  [/\b(t|tel|telephone|p|ph|phone|w|work|d|dir|direct)\b\.?\s*:?\s*$/i, "work"],
];

export function parseCard(lines) {
  const out = { name: "", title: "", company: "", phones: [], emails: [], website: "", street: "", city: "", region: "", postal: "", country: "", other: "" };
  const L = lines.map((l) => ({ ...l, text: String(l.text || "").replace(/\s+/g, " ").trim(), used: false })).filter((l) => l.text);
  if (!L.length) return out;
  const consume = (l, re) => { l.text = l.text.replace(re, " ").replace(/\s+/g, " ").replace(/^[\s|·•,;:-]+|[\s|·•,;:-]+$/g, "").trim(); if (!l.text || !/[A-Za-z0-9]{2}/.test(l.text)) l.used = true; };

  // OCR sometimes glues "name@site.com site.com" together: split after the email's real domain.
  const TLD = "com|net|org|biz|info|us|co|io|edu|gov|ai|app|dev|me|tv|ca|uk|law|health|realty|example";
  for (const l of L) l.text = l.text.replace(new RegExp("(@[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:" + TLD + "))(?=(?:www\\.)?[a-z0-9-]{2,}\\.(?:" + TLD + ")\\b)", "gi"), "$1 ");
  // emails and websites
  for (const l of L) {
    const em = l.text.match(EMAIL);
    if (em) { out.emails.push(...em); consume(l, EMAIL); l.hadContact = true; }
  }
  const domains = out.emails.map((e) => e.split("@")[1].toLowerCase());
  for (const l of L) {
    if (l.used) continue;
    const u = l.text.match(URL_RE);
    if (u && !out.website) { out.website = u[0].replace(/[.,;]$/, ""); consume(l, URL_RE); l.hadContact = true; }
  }

  // phones, with the label printed just before each number
  for (const l of L) {
    if (l.used) continue;
    const t = l.text;
    let m, lastEnd = 0, found = false;
    PHONE.lastIndex = 0;
    while ((m = PHONE.exec(t))) {
      const before = t.slice(lastEnd, m.index);
      let label = "";
      for (const [re, lab] of LABELS) if (re.test(before)) { label = lab; break; }
      if (!label && /cell|mobile/i.test(before)) label = "mobile";
      if (!label && /fax/i.test(before)) label = "fax";
      out.phones.push({ label: label || "work", number: m[0].trim() });
      lastEnd = m.index + m[0].length; found = true;
    }
    if (found) {
      consume(l, PHONE);
      // drop leftover label letters ("M", "Tel:", "Fax") but keep real words like "24 Hour Service Line"
      l.text = l.text.split(/\s+/).filter((w) => !/^(m|c|o|t|f|p|w|d|tel|ph|phone|fax|cell|mobile|mob|office|off|direct|dir|work|main)\.?:?$/i.test(w)).join(" ");
      if (!/[A-Za-z]{3}/.test(l.text)) l.used = true;
      l.hadContact = true;
    }
  }
  if (out.phones.length === 1 && out.phones[0].label === "work") { /* a lone unlabeled number stays "work" */ }

  // US address: "City, ST 12345" (possibly with the street on the same line)
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (l.used) continue;
    const m = l.text.match(CITY_LINE);
    if (!m || !STATES.has(m[2])) continue;
    let city = m[1].trim(), street = "";
    const parts = city.split(/,\s*/);
    if (parts.length > 1 && STREET.test(parts[0])) { street = parts.slice(0, -1).join(", "); city = parts[parts.length - 1]; }
    out.city = city.replace(/,$/, ""); out.region = m[2]; out.postal = m[3]; l.used = true;
    if (!street) {
      const prev = [];
      for (let j = i - 1; j >= 0 && prev.length < 2; j--) {
        const p = L[j];
        if (p.used) continue;
        if (STREET.test(p.text) || UNIT.test(p.text) || (prev.length && STREET.test(prev[0].text) === false && UNIT.test(prev[0].text))) { prev.unshift(p); continue; }
        break;
      }
      if (prev.length) { street = prev.map((p) => p.text).join(", "); prev.forEach((p) => (p.used = true)); }
    }
    out.street = street;
    break;
  }

  // name, title, company from what's left
  const rest = L.filter((l) => !l.used);
  const isName = (t) => {
    // "Dr. Maria Okafor, DDS" is still a name: ignore honorifics and credentials
    t = t.replace(/^(dr|mr|mrs|ms|mx|rev|prof)\.?\s+/i, "").replace(/,?\s+(dds|dmd|md|do|phd|jd|esq|cpa|rn|np|pa-c|pe|mba|jr|sr|ii|iii)\.?(,.*)?$/i, "").trim();
    const words = t.split(" ");
    return words.length >= 2 && words.length <= 4 && !/\d/.test(t) && !TITLE_WORDS.test(t) && !COMPANY_WORDS.test(t)
      && words.every((w) => /^[A-Z][A-Za-z'’.-]*$/.test(w) || /^[A-Z]\.?$/.test(w));
  };
  const domainMatch = (t) => {
    const s = t.toLowerCase().replace(/[^a-z0-9]/g, "");
    return s.length >= 3 && domains.concat(out.website ? [out.website.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")] : [])
      .some((d) => { const root = d.split(".")[0].replace(/[^a-z0-9]/g, ""); return root.length >= 3 && (s.includes(root) || root.includes(s)); });
  };
  const byHeight = rest.slice().sort((a, b) => (b.h || 0) - (a.h || 0));
  const nameLine = byHeight.find((l) => isName(l.text) && !domainMatch(l.text)) || rest.find((l) => isName(l.text));
  if (nameLine) { out.name = nameLine.text; nameLine.used = true; }
  const companyLine = rest.find((l) => !l.used && COMPANY_WORDS.test(l.text)) || rest.find((l) => !l.used && domainMatch(l.text));
  if (companyLine) { out.company = companyLine.text; companyLine.used = true; }
  // the title is usually right under the name; otherwise any line with job words
  const idx = nameLine ? rest.indexOf(nameLine) : -1;
  const near = idx >= 0 ? [rest[idx + 1], rest[idx - 1]].filter((l) => l && !l.used && !l.hadContact && TITLE_WORDS.test(l.text)) : [];
  const titleLine = near[0] || rest.find((l) => !l.used && !l.hadContact && TITLE_WORDS.test(l.text));
  if (titleLine) { out.title = titleLine.text; titleLine.used = true; }
  if (!out.company) { // no business words: the biggest remaining print that isn't contact info
    const big = rest.filter((l) => !l.used && !l.hadContact && /[A-Za-z]{3}/.test(l.text)).sort((a, b) => (b.h || 0) - (a.h || 0))[0];
    if (big && nameLine && (big.h || 0) >= (nameLine.h || 0) * 0.8) { out.company = big.text; big.used = true; }
  }
  out.other = rest.filter((l) => !l.used && /[A-Za-z0-9]{2}/.test(l.text)).map((l) => l.text).join("\n");
  out.emails = [...new Set(out.emails)];
  return out;
}

// Card File sends one or two photos (front, back). Fields come from the front first; the back fills gaps.
export function mergeSides(sides) {
  const out = parseCard([]);
  for (const s of sides) {
    for (const k of ["name", "title", "company", "website", "street", "city", "region", "postal", "country"]) if (!out[k] && s[k]) out[k] = s[k];
    for (const p of s.phones) if (!out.phones.some((q) => q.number.replace(/\D/g, "") === p.number.replace(/\D/g, ""))) out.phones.push(p);
    for (const e of s.emails) if (!out.emails.includes(e)) out.emails.push(e);
    if (s.other) out.other = out.other ? out.other + "\n" + s.other : s.other;
  }
  return out;
}
