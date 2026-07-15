// Seeds ~100 original, realistic job postings across the GTA so the site
// looks populated. NOT scraped from anywhere — Indeed's terms prohibit
// scraping, and republishing another platform's live listings under our
// own employer accounts would be both a ToS/legal problem and misleading
// to job seekers (their "application" wouldn't reach the real employer).
//
// Run standalone against the local DB with: node db/seed-jobs.js
// Also exported as seedJobs(db) so it can be run against the live
// production database, which lives on a Railway persistent volume that
// git-committed db/jobboard.db does NOT touch on deploy.
const bcrypt = require('bcryptjs');

const LOCATIONS = [
  'Toronto', 'Mississauga', 'Brampton', 'Vaughan', 'Markham', 'Richmond Hill',
  'Oakville', 'Etobicoke', 'Scarborough', 'North York', 'Ajax', 'Pickering',
  'Whitby', 'Oshawa', 'Burlington', 'Milton', 'Newmarket', 'Aurora',
];

// Each employer: a plausible, original company — not a scraped or real
// third-party brand. Grouped loosely by industry so job templates below
// get assigned to a sensible employer.
const EMPLOYERS = [
  { name: 'Priya Nair',        email: 'hiring@apexstaffing.example.com',   company: 'Apex Staffing Solutions',      industry: 'staffing' },
  { name: 'Daniel Costa',      email: 'jobs@metroworkforce.example.com',   company: 'Metro Workforce Group',        industry: 'staffing' },
  { name: 'Amara Okafor',      email: 'careers@gtadistro.example.com',     company: 'GTA Distribution Centre',      industry: 'warehouse' },
  { name: 'Liam Fraser',       email: 'hr@swiftlogistics.example.com',     company: 'Swift Logistics Inc',          industry: 'warehouse' },
  { name: 'Sana Malik',        email: 'jobs@cityshopretail.example.com',   company: 'CityShop Retail Group',        industry: 'retail' },
  { name: 'Robert Kim',        email: 'careers@mapleleafmart.example.com', company: 'Maple Leaf Mart',              industry: 'retail' },
  { name: 'Isabella Rossi',    email: 'hiring@goldenspoon.example.com',    company: 'Golden Spoon Hospitality',     industry: 'food' },
  { name: 'Marcus Chen',       email: 'jobs@freshbites.example.com',       company: 'Fresh Bites Catering',         industry: 'food' },
  { name: 'Fatima Sheikh',     email: 'careers@carefirsths.example.com',   company: 'CareFirst Health Services',    industry: 'healthcare' },
  { name: 'Grace Mensah',      email: 'hr@comforthomecare.example.com',    company: 'Comfort Home Care',            industry: 'healthcare' },
  { name: 'Tommy Nguyen',      email: 'jobs@buildright.example.com',       company: 'BuildRight Construction',      industry: 'construction' },
  { name: 'Andrew Wells',      email: 'careers@solidground.example.com',   company: 'Solid Ground Contracting',     industry: 'construction' },
  { name: 'Jasmine Patel',     email: 'hiring@rapidroute.example.com',     company: 'Rapid Route Delivery',         industry: 'delivery' },
  { name: 'Kevin O’Brien', email: 'jobs@quickship.example.com',        company: 'QuickShip Logistics',          industry: 'delivery' },
  { name: 'Monica Silva',      email: 'careers@sparkleclean.example.com',  company: 'SparkleClean Commercial',      industry: 'cleaning' },
  { name: 'Hassan Ali',        email: 'hr@precisionmfg.example.com',       company: 'Precision Manufacturing Co',   industry: 'manufacturing' },
  { name: 'Rachel Sato',       email: 'jobs@bridgewaybiz.example.com',     company: 'Bridgeway Business Solutions', industry: 'office' },
  { name: 'Owen Bennett',      email: 'careers@lakeviewhotel.example.com', company: 'Lakeview Hotel Group',         industry: 'hospitality' },
  { name: 'Nadia Hussain',     email: 'hiring@guardianprotect.example.com',company: 'Guardian Protection Services', industry: 'security' },
  { name: 'Chris Doyle',       email: 'jobs@connectpoint.example.com',     company: 'ConnectPoint Customer Solutions', industry: 'callcenter' },
  { name: 'Emily Tremblay',    email: 'careers@greenscape.example.com',    company: 'GreenScape Property Services', industry: 'landscaping' },
  { name: 'Victor Popescu',    email: 'hr@autocareservice.example.com',    company: 'AutoCare Service Centre',      industry: 'automotive' },
];

const SALARY_BANDS = {
  staffing:      ['$17.50/hr', '$18/hr', '$19/hr', '$20/hr'],
  warehouse:     ['$18/hr', '$19.50/hr', '$21/hr', '$23/hr'],
  retail:        ['$16.55/hr', '$17.20/hr', '$18/hr'],
  food:          ['$16.55/hr', '$17/hr', '$18.50/hr'],
  healthcare:    ['$24/hr', '$27/hr', '$31/hr', '$34/hr'],
  construction:  ['$22/hr', '$26/hr', '$30/hr'],
  delivery:      ['$18.50/hr', '$20/hr', '$22/hr'],
  cleaning:      ['$17/hr', '$17.75/hr'],
  manufacturing: ['$19/hr', '$21/hr', '$23.50/hr'],
  office:        ['$45,000/year', '$52,000/year', '$58,000/year'],
  hospitality:   ['$17.50/hr', '$19/hr'],
  security:      ['$18/hr', '$19.50/hr'],
  callcenter:    ['$19/hr', '$21/hr'],
  landscaping:   ['$19/hr', '$21/hr'],
  automotive:    ['$21/hr', '$25/hr', '$28/hr'],
};

// title, job_type, industry, description-builder(company, location, salary)
const TEMPLATES = [
  ['Warehouse Associate', 'Full-time', 'warehouse', (c, l, s) =>
    `${c} is hiring Warehouse Associates for our ${l} distribution facility. You'll pick, pack, and prepare orders for shipment, operate handheld scanners, and keep our warehouse organized and safe.\n\nResponsibilities:\n- Pick and pack customer orders accurately\n- Load and unload delivery trucks\n- Maintain a clean, organized work area\n- Follow all workplace safety procedures\n\nRequirements:\n- Able to lift up to 50 lbs repeatedly\n- Comfortable standing/walking for a full shift\n- Reliable, punctual, team player\n- Previous warehouse experience an asset but not required\n\nCompensation: ${s}. Full-time, day and evening shifts available.`],
  ['Forklift Operator', 'Full-time', 'warehouse', (c, l, s) =>
    `${c} is looking for a certified Forklift Operator to join our ${l} team. You'll move product throughout the warehouse, load trucks, and support our inventory team.\n\nResponsibilities:\n- Operate sit-down and/or reach forklifts safely\n- Load/unload trailers\n- Maintain accurate inventory counts\n- Perform pre-shift equipment inspections\n\nRequirements:\n- Valid forklift certification (or willingness to obtain)\n- 1+ years of forklift experience preferred\n- Strong attention to detail and safety focus\n\nCompensation: ${s}. Full-time.`],
  ['Delivery Driver', 'Full-time', 'delivery', (c, l, s) =>
    `${c} needs reliable Delivery Drivers based out of ${l} to handle local package and parcel delivery routes.\n\nResponsibilities:\n- Deliver packages safely and on schedule\n- Use a handheld device to scan and confirm deliveries\n- Provide friendly, professional customer service\n- Perform basic vehicle safety checks\n\nRequirements:\n- Valid G driver's licence with a clean abstract\n- Able to lift packages up to 50 lbs\n- Comfortable working outdoors in all weather\n\nCompensation: ${s} plus mileage. Full-time, routes 5 days/week.`],
  ['AZ/DZ Truck Driver', 'Full-time', 'delivery', (c, l, s) =>
    `${c} is hiring an experienced AZ/DZ Truck Driver for regional routes out of our ${l} depot.\n\nResponsibilities:\n- Safely operate a company truck on assigned routes\n- Complete pre/post-trip inspections and logs\n- Load/unload freight as required\n- Maintain a clean driving record\n\nRequirements:\n- Valid AZ or DZ licence, clean abstract\n- 2+ years of commercial driving experience\n- Knowledge of GTA road network\n\nCompensation: ${s}. Full-time.`],
  ['Customer Service Representative', 'Full-time', 'callcenter', (c, l, s) =>
    `${c} is growing our ${l} contact centre team and looking for Customer Service Representatives to support our clients by phone, email, and chat.\n\nResponsibilities:\n- Respond to customer inquiries professionally and efficiently\n- Resolve issues and escalate where needed\n- Accurately document interactions in our CRM\n- Meet quality and productivity targets\n\nRequirements:\n- Strong verbal and written communication skills\n- Comfortable with computers and multitasking\n- Previous call centre or customer service experience an asset\n\nCompensation: ${s}. Full-time, on-site.`],
  ['Retail Sales Associate', 'Part-time', 'retail', (c, l, s) =>
    `${c} is hiring friendly, motivated Retail Sales Associates for our ${l} location.\n\nResponsibilities:\n- Greet and assist customers on the sales floor\n- Process transactions at the register\n- Restock shelves and maintain store presentation\n- Support seasonal promotions and inventory counts\n\nRequirements:\n- Positive attitude, strong customer service skills\n- Able to work evenings/weekends\n- Retail experience an asset but not required\n\nCompensation: ${s}. Part-time, flexible scheduling.`],
  ['Store Supervisor', 'Full-time', 'retail', (c, l, s) =>
    `${c} is looking for a Store Supervisor to help lead our ${l} team, oversee daily operations, and deliver an excellent customer experience.\n\nResponsibilities:\n- Supervise and support front-line staff\n- Manage opening/closing procedures and cash reconciliation\n- Handle customer escalations\n- Support merchandising and inventory management\n\nRequirements:\n- 1-2 years of retail supervisory experience\n- Strong leadership and communication skills\n- Available for a flexible schedule including weekends\n\nCompensation: ${s}. Full-time.`],
  ['Line Cook', 'Full-time', 'food', (c, l, s) =>
    `${c} is hiring a Line Cook for our busy ${l} kitchen. Join a fast-paced team serving fresh, quality food every day.\n\nResponsibilities:\n- Prepare menu items to recipe and quality standards\n- Maintain a clean, organized, food-safe station\n- Work efficiently during peak service periods\n- Follow all food safety and sanitation guidelines\n\nRequirements:\n- Previous kitchen experience preferred\n- Food Handler Certification an asset (or willingness to obtain)\n- Able to work evenings/weekends\n\nCompensation: ${s}. Full-time.`],
  ['Server', 'Part-time', 'food', (c, l, s) =>
    `${c} is looking for an enthusiastic Server to join our ${l} restaurant team.\n\nResponsibilities:\n- Take orders and serve food/beverages promptly\n- Provide attentive, friendly customer service\n- Process payments accurately\n- Support table setup and closing duties\n\nRequirements:\n- Smart Serve certification (or willing to obtain)\n- Previous serving experience an asset\n- Available evenings and weekends\n\nCompensation: ${s} plus tips. Part-time.`],
  ['Dishwasher / Kitchen Helper', 'Part-time', 'food', (c, l, s) =>
    `${c} needs a reliable Dishwasher/Kitchen Helper for our ${l} location to keep the kitchen running smoothly.\n\nResponsibilities:\n- Wash dishes, utensils, and kitchen equipment\n- Assist cooks with basic food prep\n- Keep kitchen and storage areas clean and organized\n- Take out trash and recycling per schedule\n\nRequirements:\n- Able to stand for extended periods\n- Reliable and hardworking\n- No experience necessary, will train\n\nCompensation: ${s}. Part-time, evening shifts.`],
  ['Personal Support Worker (PSW)', 'Full-time', 'healthcare', (c, l, s) =>
    `${c} is hiring compassionate Personal Support Workers to provide in-home care to clients throughout ${l} and surrounding areas.\n\nResponsibilities:\n- Assist clients with daily living activities (bathing, dressing, mobility)\n- Provide companionship and light housekeeping\n- Monitor and report changes in client condition\n- Follow individualized care plans\n\nRequirements:\n- Valid PSW certificate\n- Valid driver's licence and access to a vehicle preferred\n- Compassionate, patient, reliable\n\nCompensation: ${s}. Full-time, flexible shifts.`],
  ['Registered Practical Nurse (RPN)', 'Full-time', 'healthcare', (c, l, s) =>
    `${c} is seeking a Registered Practical Nurse to join our care team serving clients in ${l}.\n\nResponsibilities:\n- Administer medications and treatments per care plan\n- Monitor and document client health status\n- Coordinate with families and care teams\n- Provide clinical support and guidance to PSWs\n\nRequirements:\n- Current RPN registration in good standing with CNO\n- Strong clinical and communication skills\n- Previous home care or long-term care experience an asset\n\nCompensation: ${s}. Full-time.`],
  ['Construction Labourer', 'Full-time', 'construction', (c, l, s) =>
    `${c} is hiring General Labourers for active job sites across ${l}.\n\nResponsibilities:\n- Assist tradespeople with daily tasks\n- Load/unload materials and keep the site clean\n- Operate basic hand and power tools\n- Follow all site safety protocols\n\nRequirements:\n- Valid Working at Heights and WHMIS certification (or willing to obtain)\n- Able to perform physical labour outdoors\n- Reliable transportation to job sites\n\nCompensation: ${s}. Full-time.`],
  ['Electrician’s Helper', 'Full-time', 'construction', (c, l, s) =>
    `${c} is looking for an Electrician's Helper to support our licensed electricians on residential and commercial projects around ${l}.\n\nResponsibilities:\n- Assist with running conduit, pulling wire, and installing fixtures\n- Keep job sites organized and stocked with materials\n- Follow instructions and site safety procedures\n- Learn on the job from experienced tradespeople\n\nRequirements:\n- Some electrical or construction experience preferred\n- Valid driver's licence an asset\n- Willingness to learn and work hard\n\nCompensation: ${s}. Full-time.`],
  ['Commercial Cleaner', 'Part-time', 'cleaning', (c, l, s) =>
    `${c} is hiring Commercial Cleaners for evening shifts at office and retail locations across ${l}.\n\nResponsibilities:\n- Clean and sanitize offices, washrooms, and common areas\n- Vacuum, mop, and dust as scheduled\n- Restock supplies and report maintenance issues\n- Follow site-specific cleaning checklists\n\nRequirements:\n- Reliable and detail-oriented\n- Able to work independently\n- Previous cleaning experience an asset\n\nCompensation: ${s}. Part-time, evenings.`],
  ['Machine Operator', 'Full-time', 'manufacturing', (c, l, s) =>
    `${c} is hiring a Machine Operator for our ${l} production facility.\n\nResponsibilities:\n- Set up, operate, and monitor production machinery\n- Perform quality checks on finished product\n- Complete basic maintenance and troubleshooting\n- Maintain accurate production records\n\nRequirements:\n- Previous manufacturing/machine operation experience preferred\n- Comfortable working in a fast-paced production environment\n- Able to lift up to 40 lbs\n\nCompensation: ${s}. Full-time, rotating shifts.`],
  ['Packaging Associate', 'Full-time', 'manufacturing', (c, l, s) =>
    `${c} needs Packaging Associates for our ${l} facility to prepare finished goods for shipment.\n\nResponsibilities:\n- Package and label products per specifications\n- Inspect products for quality before packing\n- Keep packaging line stocked and organized\n- Meet daily production targets\n\nRequirements:\n- Able to stand and perform repetitive tasks for a full shift\n- Attention to detail\n- Previous production experience an asset\n\nCompensation: ${s}. Full-time.`],
  ['Administrative Assistant', 'Full-time', 'office', (c, l, s) =>
    `${c} is hiring an Administrative Assistant to support our ${l} office.\n\nResponsibilities:\n- Answer phones and greet visitors\n- Manage scheduling, correspondence, and filing\n- Support other departments with data entry and document prep\n- Order office supplies and maintain office organization\n\nRequirements:\n- Strong organizational and communication skills\n- Proficient with Microsoft Office / Google Workspace\n- 1+ years of administrative experience preferred\n\nCompensation: ${s}. Full-time.`],
  ['Data Entry Clerk', 'Full-time', 'office', (c, l, s) =>
    `${c} is looking for a detail-oriented Data Entry Clerk for our ${l} office.\n\nResponsibilities:\n- Accurately input and update records in our database\n- Verify data for accuracy and completeness\n- Generate basic reports as needed\n- Maintain confidentiality of sensitive information\n\nRequirements:\n- Strong typing speed and accuracy\n- Comfortable with spreadsheets and data entry software\n- High attention to detail\n\nCompensation: ${s}. Full-time.`],
  ['HR Coordinator', 'Full-time', 'office', (c, l, s) =>
    `${c} is hiring an HR Coordinator to support recruitment and day-to-day HR operations at our ${l} office.\n\nResponsibilities:\n- Coordinate job postings, screening, and interview scheduling\n- Support onboarding for new hires\n- Maintain accurate employee records\n- Assist with HR policies and employee inquiries\n\nRequirements:\n- 1-2 years of HR or recruitment experience\n- Strong interpersonal and organizational skills\n- Post-secondary education in HR or related field an asset\n\nCompensation: ${s}. Full-time.`],
  ['Hotel Front Desk Agent', 'Full-time', 'hospitality', (c, l, s) =>
    `${c} is hiring a Front Desk Agent for our ${l} hotel.\n\nResponsibilities:\n- Check guests in/out and handle reservations\n- Respond to guest questions and requests promptly\n- Process payments and maintain accurate records\n- Provide a warm, professional welcome to all guests\n\nRequirements:\n- Strong customer service and communication skills\n- Comfortable with hotel booking software (training provided)\n- Available for rotating shifts including weekends\n\nCompensation: ${s}. Full-time.`],
  ['Housekeeping Attendant', 'Part-time', 'hospitality', (c, l, s) =>
    `${c} needs Housekeeping Attendants to maintain our ${l} property to a high standard of cleanliness.\n\nResponsibilities:\n- Clean and prepare guest rooms per hotel standards\n- Restock linens and amenities\n- Report maintenance issues\n- Maintain cleanliness of common areas\n\nRequirements:\n- Reliable, detail-oriented, hardworking\n- Able to be on your feet for a full shift\n- Previous housekeeping experience an asset\n\nCompensation: ${s}. Part-time.`],
  ['Security Guard', 'Full-time', 'security', (c, l, s) =>
    `${c} is hiring licensed Security Guards for commercial sites across ${l}.\n\nResponsibilities:\n- Monitor premises and conduct regular patrols\n- Control access and check credentials\n- Respond to incidents and complete accurate reports\n- Provide a visible, professional security presence\n\nRequirements:\n- Valid Ontario Security Guard licence\n- Valid First Aid/CPR an asset\n- Clean background check\n\nCompensation: ${s}. Full-time, various shifts.`],
  ['Concierge / Building Attendant', 'Full-time', 'security', (c, l, s) =>
    `${c} is looking for a Concierge/Building Attendant for a residential property in ${l}.\n\nResponsibilities:\n- Greet residents and visitors professionally\n- Monitor building access and security cameras\n- Receive and log packages and deliveries\n- Respond to resident inquiries and concerns\n\nRequirements:\n- Valid Ontario Security Guard licence\n- Excellent customer service skills\n- Reliable and professional appearance\n\nCompensation: ${s}. Full-time.`],
  ['Landscaper / Groundskeeper', 'Full-time', 'landscaping', (c, l, s) =>
    `${c} is hiring Landscapers for the season to maintain properties across ${l}.\n\nResponsibilities:\n- Mow, trim, and maintain lawns and gardens\n- Operate landscaping equipment safely\n- Perform seasonal cleanups and planting\n- Maintain a clean, professional worksite\n\nRequirements:\n- Comfortable with outdoor physical work\n- Valid driver's licence an asset\n- Previous landscaping experience preferred\n\nCompensation: ${s}. Full-time, seasonal.`],
  ['Automotive Technician', 'Full-time', 'automotive', (c, l, s) =>
    `${c} is hiring an Automotive Technician for our ${l} service centre.\n\nResponsibilities:\n- Diagnose and repair vehicle mechanical/electrical issues\n- Perform routine maintenance (oil changes, brakes, tires)\n- Provide accurate estimates and documentation\n- Maintain a clean, organized bay\n\nRequirements:\n- Certified automotive technician (310S an asset)\n- Own tools preferred\n- Strong diagnostic and problem-solving skills\n\nCompensation: ${s}. Full-time.`],
  ['Lube Technician', 'Full-time', 'automotive', (c, l, s) =>
    `${c} needs a Lube Technician for our fast-paced ${l} shop.\n\nResponsibilities:\n- Perform oil changes and routine maintenance services\n- Inspect vehicles and advise customers on needed service\n- Keep the shop clean and organized\n- Provide friendly, efficient customer service\n\nRequirements:\n- Some automotive experience preferred\n- Valid driver's licence\n- Willingness to learn\n\nCompensation: ${s}. Full-time.`],
  ['General Labourer (Staffing)', 'Full-time', 'staffing', (c, l, s) =>
    `${c} has immediate General Labourer positions available with multiple clients across ${l}. Great opportunity to gain experience across warehouse, light industrial, and production environments.\n\nResponsibilities:\n- Perform general labour duties as assigned\n- Follow all workplace safety procedures\n- Work as part of a team to meet daily targets\n- Maintain a clean and organized work area\n\nRequirements:\n- Able to perform physical work and lift up to 40 lbs\n- Steel-toe boots required\n- Reliable transportation to job site\n\nCompensation: ${s}. Full-time, immediate start.`],
  ['Order Picker (Staffing)', 'Full-time', 'staffing', (c, l, s) =>
    `${c} is currently placing Order Pickers with warehouse clients in ${l}.\n\nResponsibilities:\n- Pick and prepare orders using an RF scanner\n- Meet daily productivity and accuracy targets\n- Maintain a safe, organized picking area\n- Report any equipment or inventory issues\n\nRequirements:\n- Previous order picking/warehouse experience preferred\n- Comfortable using handheld scanning equipment\n- Able to work standing/walking for a full shift\n\nCompensation: ${s}. Full-time.`],
];

function randomRecentTimestamp() {
  // Within the last 48 hours, matching "recent, last 2 days" — SQLite datetime format.
  const now = Date.now();
  const offsetMs = Math.floor(Math.random() * 48 * 60 * 60 * 1000);
  return new Date(now - offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function ensureEmployer(db, e) {
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(e.email);
  if (user) return user.id;
  const hash = bcrypt.hashSync('SeedEmployer#' + Math.random().toString(36).slice(2, 10), 10);
  const info = db.prepare(`
    INSERT INTO users (name, email, password, role, company_name, status, email_verified, require_review)
    VALUES (?, ?, ?, 'employer', ?, 'active', 1, 0)
  `).run(e.name, e.email, hash, e.company);
  return info.lastInsertRowid;
}

function seedJobs(db) {
  const employerIds = {};
  EMPLOYERS.forEach(e => { employerIds[e.company] = { id: ensureEmployer(db, e), industry: e.industry, company: e.company }; });

  const byIndustry = {};
  Object.values(employerIds).forEach(e => {
    byIndustry[e.industry] = byIndustry[e.industry] || [];
    byIndustry[e.industry].push(e);
  });

  const insertJob = db.prepare(`
    INSERT INTO jobs (employer_id, title, company, location, job_type, salary, description, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?)
  `);
  const existsCheck = db.prepare('SELECT id FROM jobs WHERE title = ? AND company = ? AND location = ?');

  const TARGET = 100;
  let created = 0;
  let attempts = 0;

  while (created < TARGET && attempts < TARGET * 4) {
    attempts++;
    const [title, jobType, industry, describe] = pick(TEMPLATES);
    const pool = byIndustry[industry];
    if (!pool || pool.length === 0) continue;
    const employer = pick(pool);
    const location = pick(LOCATIONS);
    const salary = pick(SALARY_BANDS[industry]);

    if (existsCheck.get(title, employer.company, location)) continue; // avoid exact duplicates

    const description = describe(employer.company, location, salary);
    insertJob.run(
      employer.id, title, employer.company, location, jobType, salary,
      description, randomRecentTimestamp()
    );
    created++;
  }

  return { created, employers: EMPLOYERS.length };
}

module.exports = { seedJobs };

if (require.main === module) {
  require('dotenv').config();
  const db = require('./db');
  const result = seedJobs(db);
  console.log(`Seeded ${result.created} job postings across ${result.employers} employers.`);
}
