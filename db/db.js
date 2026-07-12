const path = require('path');
const fs = require('fs');

// DB_PATH env var lets Railway (or any host) store the file on a persistent volume
const ABS_PATH = process.env.DB_PATH || path.join(__dirname, 'jobboard.db');

// On first deploy, seed the volume with the bundled database so existing data carries over
if (process.env.DB_PATH && !fs.existsSync(ABS_PATH)) {
  const bundled = path.join(__dirname, 'jobboard.db');
  if (fs.existsSync(bundled)) {
    fs.mkdirSync(path.dirname(ABS_PATH), { recursive: true });
    fs.copyFileSync(bundled, ABS_PATH);
  }
}

// node-sqlite3-wasm needs a path relative to process.cwd()
const REL_PATH = path.relative(process.cwd(), ABS_PATH);

let db;

// Try better-sqlite3 first (works on Mac/local dev and some Linux hosts).
// If its native binary can't load, fall back to node-sqlite3-wasm (pure WASM,
// no compilation needed — works on any Linux server).
try {
  const BetterSqlite = require('better-sqlite3');
  db = new BetterSqlite(ABS_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (_) {
  const { Database: WasmDB } = require('node-sqlite3-wasm');

  class WasmStatement {
    constructor(s) { this._s = s; }
    run(...a)  { return this._s.run(a.length ? a : []); }
    get(...a)  { const r = this._s.get(a.length ? a : []); return r === undefined ? null : r; }
    all(...a)  { return this._s.all(a.length ? a : []); }
  }

  class WasmDatabase {
    constructor(p) { this._db = new WasmDB(p); }
    pragma(s)  { this._db.run(`PRAGMA ${s}`); }
    exec(sql)  { this._db.exec(sql); }
    prepare(sql) { return new WasmStatement(this._db.prepare(sql)); }
  }

  db = new WasmDatabase(REL_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

// Run schema.sql every start. All statements use IF NOT EXISTS, so this is
// safe to run repeatedly and keeps setup to a single step.
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migrations — run once; silently ignored if column already exists.
try { db.exec('ALTER TABLE applications ADD COLUMN resume_file TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN phone TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN address TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN city TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN province TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN postal_code TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE blog_posts ADD COLUMN featured_image TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN active INTEGER DEFAULT 1'); } catch (e) {}
try { db.exec('ALTER TABLE applications ADD COLUMN seen_by_employer INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE applications ADD COLUMN applicant_name TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE applications ADD COLUMN applicant_email TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE applications ADD COLUMN applicant_phone TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE applications ADD COLUMN work_eligible INTEGER'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN require_review INTEGER DEFAULT 1'); } catch (e) {}

// Key-value site settings
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )
`);
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('require_job_review', '1')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('blog_per_page', '10')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('ads_enabled', '1')").run();

// Pages CMS table
db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    meta TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Seed default page content (INSERT OR IGNORE — never overwrites edits)
const seedPages = db.prepare('INSERT OR IGNORE INTO pages (slug, title, content, meta) VALUES (?, ?, ?, ?)');
seedPages.run('privacy', 'Privacy Policy', `<h2>1. Information We Collect</h2>
<p>When you use GTA Hiring, we may collect the following types of information:</p>
<ul>
  <li><strong>Account information</strong> — your name, email address, and password when you register.</li>
  <li><strong>Profile information</strong> — phone number, address, city, province, and postal code if you choose to add them.</li>
  <li><strong>Job application data</strong> — resume files, work eligibility status, and any details you submit when applying for a job.</li>
  <li><strong>Employer data</strong> — company name, job postings, and business contact information.</li>
  <li><strong>Usage data</strong> — pages visited, search queries, and session information collected automatically.</li>
</ul>

<h2>2. How We Use Your Information</h2>
<p>We use the information we collect to:</p>
<ul>
  <li>Create and manage your account.</li>
  <li>Match job seekers with relevant employers.</li>
  <li>Send job application details to the appropriate employer.</li>
  <li>Communicate important updates about your account or postings.</li>
  <li>Improve the platform and monitor for abuse or fraud.</li>
</ul>

<h2>3. Sharing Your Information</h2>
<p>We do not sell your personal information to third parties. Your resume and application details are shared only with the employer you applied to. Employer job postings are visible publicly on the platform.</p>

<h2>4. Data Retention</h2>
<p>We retain your account data for as long as your account is active. You may request deletion of your account and associated data at any time by contacting us. Application records may be retained for a limited period for legal and audit purposes.</p>

<h2>5. Cookies</h2>
<p>GTA Hiring uses session cookies to keep you logged in. We do not use tracking cookies or third-party advertising cookies. You can disable cookies in your browser settings, but some features of the site may not function correctly.</p>

<h2>6. Security</h2>
<p>We take reasonable technical and organizational measures to protect your data. Passwords are hashed and never stored in plain text. Resume files are stored securely and only accessible to authorized parties.</p>

<h2>7. Your Rights</h2>
<p>You have the right to access, correct, or delete your personal information. To exercise these rights, please <a href="/contact">contact us</a>. Residents of Ontario may also have rights under PIPEDA and Ontario's privacy laws.</p>

<h2>8. Changes to This Policy</h2>
<p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date. Continued use of GTA Hiring after changes are posted constitutes acceptance of the revised policy.</p>

<h2>9. Contact</h2>
<p>If you have any questions about this policy, please reach out via our <a href="/contact">Contact Us</a> page.</p>`, '{}');

seedPages.run('terms', 'Terms & Conditions', `<h2>1. Acceptance of Terms</h2>
<p>By accessing or using GTA Hiring ("the Platform"), you agree to be bound by these Terms &amp; Conditions. If you do not agree, please do not use the Platform.</p>

<h2>2. Eligibility</h2>
<p>You must be at least 18 years old to create an account. By registering, you confirm that all information you provide is accurate and complete.</p>

<h2>3. User Accounts</h2>
<ul>
  <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
  <li>You must notify us immediately if you suspect unauthorized access to your account.</li>
  <li>We reserve the right to suspend or terminate accounts that violate these terms.</li>
</ul>

<h2>4. Employer Responsibilities</h2>
<ul>
  <li>Employers must only post genuine, lawful job opportunities available in the Greater Toronto Area.</li>
  <li>Job postings must not contain discriminatory, misleading, or illegal content.</li>
  <li>Employers are responsible for communicating with applicants in a respectful and timely manner.</li>
  <li>GTA Hiring reserves the right to remove any job posting that violates these terms without notice.</li>
</ul>

<h2>5. Job Seeker Responsibilities</h2>
<ul>
  <li>Job seekers must provide accurate information in their profiles and applications.</li>
  <li>Submitting false documents (e.g., fabricated resumes) is strictly prohibited.</li>
  <li>Seekers must not apply to positions they are clearly ineligible for with the intent to spam employers.</li>
</ul>

<h2>6. Content Standards</h2>
<p>All content posted on the Platform must not be offensive, defamatory, or harassing; violate any applicable laws; or infringe on third-party intellectual property rights.</p>

<h2>7. Limitation of Liability</h2>
<p>GTA Hiring acts as a platform connecting employers and job seekers. We do not guarantee employment outcomes or the accuracy of job listings. To the maximum extent permitted by law, we are not liable for any indirect, incidental, or consequential damages arising from your use of the Platform.</p>

<h2>8. Intellectual Property</h2>
<p>All content, design, and branding on GTA Hiring (excluding user-submitted content) are the property of GTA Hiring. You may not reproduce or distribute any part of the Platform without written permission.</p>

<h2>9. Governing Law</h2>
<p>These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada applicable therein. Any disputes shall be resolved in the courts of Ontario.</p>

<h2>10. Changes to Terms</h2>
<p>We may revise these Terms at any time. Changes will be posted on this page. Continued use of the Platform after changes are posted constitutes your acceptance of the revised Terms.</p>

<h2>11. Contact</h2>
<p>Questions about these Terms? Visit our <a href="/contact">Contact Us</a> page.</p>`, '{}');

seedPages.run('contact', 'Contact Us', '<p>Have a question, found an issue, or want to work with us? Fill in the form and we\'ll get back to you as soon as possible.</p>',
  JSON.stringify({ email: 'hello@gtahiring.ca', location: 'Greater Toronto Area, Ontario', response_time: 'Within 1–2 business days' }));

module.exports = db;
