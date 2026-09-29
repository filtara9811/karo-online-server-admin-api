import "dotenv/config";
import { getPool } from "../src/lib/pg-client.js";

// Showcase vendors around Chandni Chowk (Delhi-6, 110006): 5 per sub-category that has catalog items.
// They are offline with no phone/WhatsApp and no login, so they are listed but never receive leads.
// Ids are derived from the shop name, so re-running updates the same rows.
//   npx tsx scripts/seed-delhi6.ts

type Spot = { street: string; lat: number; lng: number };
const SPOTS: Spot[] = [
  { street: "Chandni Chowk Main Road", lat: 28.6562, lng: 77.231 },
  { street: "Kinari Bazaar", lat: 28.656, lng: 77.2335 },
  { street: "Dariba Kalan", lat: 28.6553, lng: 77.233 },
  { street: "Nai Sarak", lat: 28.6525, lng: 77.227 },
  { street: "Ballimaran", lat: 28.6568, lng: 77.2262 },
  { street: "Chawri Bazar", lat: 28.649, lng: 77.227 },
  { street: "Sita Ram Bazar", lat: 28.6465, lng: 77.225 },
  { street: "Fatehpuri", lat: 28.657, lng: 77.222 },
  { street: "Katra Neel", lat: 28.6575, lng: 77.2285 },
  { street: "Paranthe Wali Gali", lat: 28.6566, lng: 77.2305 },
  { street: "Kucha Pati Ram", lat: 28.648, lng: 77.2255 },
  { street: "Matia Mahal", lat: 28.6495, lng: 77.2345 },
  { street: "Urdu Bazar, Jama Masjid", lat: 28.651, lng: 77.234 },
  { street: "Esplanade Road", lat: 28.6545, lng: 77.235 },
  { street: "Bhagirath Palace", lat: 28.6583, lng: 77.2295 },
  { street: "Lajpat Rai Market", lat: 28.657, lng: 77.2365 },
  { street: "Hauz Qazi", lat: 28.6475, lng: 77.2275 },
];

type Shop = { name: string; owner: string; bio: string };
const SHOPS: Record<string, { trade: string; shops: Shop[] }> = {
  "2 Delivery": { trade: "service", shops: [
    { name: "Chandni Chowk Express Couriers", owner: "Rakesh Gupta", bio: "Same-day parcel pickup and drop across Old Delhi." },
    { name: "Purani Dilli Delivery Wale", owner: "Imran Qureshi", bio: "Local deliveries from the wholesale markets to your door." },
    { name: "Fatehpuri Speed Movers", owner: "Sunil Yadav", bio: "Two-wheeler and tempo deliveries for shops and homes." },
    { name: "Jama Masjid Quick Drop", owner: "Faizan Ahmed", bio: "Food, documents and small parcels delivered fast." },
    { name: "Sadar Bazar Link Logistics", owner: "Manoj Sharma", bio: "Bulk goods transport between Delhi-6 markets." },
  ] },
  "Bank sarvic": { trade: "service", shops: [
    { name: "Gupta Finance Point", owner: "Anil Gupta", bio: "Account opening, cash deposit help and passbook updates." },
    { name: "Chawri Bazar Money Mitra", owner: "Deepak Jain", bio: "Banking help desk: KYC, AEPS withdrawals and transfers." },
    { name: "Ballimaran Digital Seva Kendra", owner: "Shahid Khan", bio: "Mini bank, bill payments and money transfer." },
    { name: "Dariba CSP Banking Centre", owner: "Vikas Agarwal", bio: "Customer service point for savings and remittances." },
    { name: "Nai Sarak Loan & Bank Help", owner: "Pankaj Bansal", bio: "Loan paperwork, account services and insurance guidance." },
  ] },
  "AC  sarvice": { trade: "service", shops: [
    { name: "Cool Point AC Services", owner: "Mohd Salim", bio: "AC repair, gas refill and servicing for split and window units." },
    { name: "Delhi-6 Cooling Solutions", owner: "Rajesh Kumar", bio: "Installation, uninstallation and annual maintenance." },
    { name: "Frosty Air Care", owner: "Arif Hussain", bio: "Same-day AC servicing in Old Delhi." },
    { name: "Bhagirath AC Repair Centre", owner: "Naveen Aggarwal", bio: "Compressor, PCB and cooling problems fixed." },
    { name: "Chill Zone Air Conditioners", owner: "Sameer Malik", bio: "Jet wash servicing and genuine spare parts." },
  ] },
  "Animal Pet Care": { trade: "service", shops: [
    { name: "Old Delhi Pet Clinic", owner: "Dr. Nadeem Akhtar", bio: "Vaccination, check-ups and pet grooming." },
    { name: "Paws & Tails Pet Shop", owner: "Ritu Mehra", bio: "Pet food, accessories and grooming." },
    { name: "Chandni Chowk Birds & Pets", owner: "Javed Ansari", bio: "Bird care, cages, feed and advice." },
    { name: "Happy Pets Home Visit", owner: "Dr. Kunal Sethi", bio: "Vet home visits and pet boarding." },
    { name: "Furry Friends Care Centre", owner: "Sana Parveen", bio: "Bathing, grooming and pet supplies." },
  ] },
  "Beauty Parlour": { trade: "service", shops: [
    { name: "Glamour Ladies Beauty Parlour", owner: "Neha Arora", bio: "Facials, threading, waxing and bridal makeup." },
    { name: "Noor Beauty Salon", owner: "Farah Naaz", bio: "Mehndi, makeup and hair treatments." },
    { name: "Roop Shringar Parlour", owner: "Pooja Verma", bio: "Party makeup and skin care at home or in salon." },
    { name: "Kinari Bridal Studio", owner: "Simran Kaur", bio: "Bridal packages with mehndi and draping." },
    { name: "Shine & Glow Beauty Point", owner: "Aisha Siddiqui", bio: "Cleanup, pedicure and hair spa." },
  ] },
  Carpenter: { trade: "service", shops: [
    { name: "Sharma Wood Works", owner: "Ramesh Sharma", bio: "Furniture repair, polishing and custom cabinets." },
    { name: "Hauz Qazi Furniture Karigar", owner: "Mohd Aslam", bio: "Doors, beds and modular kitchen work." },
    { name: "Vishwakarma Carpentry", owner: "Suresh Vishwakarma", bio: "New furniture and wood repairs at home." },
    { name: "Old Delhi Interiors & Wood", owner: "Tariq Mirza", bio: "Wardrobes, shelves and false-ceiling frames." },
    { name: "Royal Furniture Repair", owner: "Harish Chand", bio: "Sofa, chair and table repair with polish." },
  ] },
  "ccvt camra": { trade: "service", shops: [
    { name: "Secure Eye CCTV Solutions", owner: "Amit Khanna", bio: "CCTV installation for shops and homes." },
    { name: "Chandni Chowk Security Systems", owner: "Zeeshan Ali", bio: "HD cameras, DVR setup and mobile viewing." },
    { name: "Lajpat Rai CCTV Market Services", owner: "Rohit Jain", bio: "Camera repair, wiring and AMC." },
    { name: "Third Eye Surveillance", owner: "Farhan Qadri", bio: "IP cameras and remote monitoring setup." },
    { name: "Safe Home Camera Point", owner: "Gaurav Mittal", bio: "Wireless cameras and doorbell cams installed." },
  ] },
  Chef: { trade: "service", shops: [
    { name: "Karim's Style Home Chef", owner: "Chef Rizwan", bio: "Mughlai cooking for parties and events." },
    { name: "Purani Dilli Halwai Services", owner: "Mahesh Halwai", bio: "Sweets and snacks for functions." },
    { name: "Jain Rasoi Home Cooks", owner: "Sarla Jain", bio: "Pure veg home cooking and tiffin." },
    { name: "Nihari Masters Catering", owner: "Chef Ashraf", bio: "Nihari, biryani and kebab catering." },
    { name: "Paranthe Wale Party Cooks", owner: "Kishan Lal", bio: "Live paratha and chaat counters." },
  ] },
  Cleaner: { trade: "service", shops: [
    { name: "Sparkle Home Cleaning", owner: "Vijay Kumar", bio: "Deep cleaning for homes and shops." },
    { name: "Delhi-6 Sofa & Carpet Cleaners", owner: "Shakeel Ahmed", bio: "Sofa shampoo, carpet and mattress cleaning." },
    { name: "Clean Nest Services", owner: "Ritesh Gupta", bio: "Kitchen and bathroom deep cleaning." },
    { name: "Fresh Space Cleaning Co.", owner: "Nazia Begum", bio: "Move-in and move-out cleaning." },
    { name: "Shine Pro Facility Services", owner: "Ajay Rawat", bio: "Office and shop cleaning on contract." },
  ] },
  Electronics: { trade: "retailer", shops: [
    { name: "Bhagirath Electronics Hub", owner: "Sanjay Aggarwal", bio: "LED lights, switches and electrical goods." },
    { name: "Lajpat Rai Mobile & Gadgets", owner: "Adil Khan", bio: "Mobile accessories and gadget repair." },
    { name: "Chandni Chowk TV & Audio Centre", owner: "Prem Kumar", bio: "TV, speakers and home theatre sales and repair." },
    { name: "Jain Electricals", owner: "Rajiv Jain", bio: "Wholesale wires, fans and fittings." },
    { name: "Digital World Electronics", owner: "Irfan Malik", bio: "Chargers, power banks and computer parts." },
  ] },
  panter: { trade: "service", shops: [
    { name: "Rang Mahal Painters", owner: "Mukesh Kumar", bio: "Interior and exterior painting with putty work." },
    { name: "Old Delhi Paint Contractors", owner: "Wasim Akram", bio: "Wall texture, waterproofing and polish." },
    { name: "Colour Craft Home Painting", owner: "Dinesh Pal", bio: "Room painting with free colour advice." },
    { name: "Chawri Bazar Paint Works", owner: "Sohail Rana", bio: "Shop shutters, grills and wood painting." },
    { name: "Perfect Finish Painters", owner: "Rahul Saini", bio: "Royale, emulsion and distemper work." },
  ] },
  Plumber: { trade: "service", shops: [
    { name: "Quick Fix Plumbing Delhi-6", owner: "Raju Plumber", bio: "Leak repair, tap fitting and blockage clearing." },
    { name: "Ballimaran Sanitary & Plumbing", owner: "Mohd Yusuf", bio: "Bathroom fittings and pipeline work." },
    { name: "Aqua Care Plumbers", owner: "Santosh Kumar", bio: "Water tank, motor and geyser installation." },
    { name: "Hauz Qazi Pipe Fitters", owner: "Naseem Ahmed", bio: "Drainage, sewer line and pipe replacement." },
    { name: "Jal Seva Plumbing Services", owner: "Om Prakash", bio: "24x7 emergency plumbing in Old Delhi." },
  ] },
  TAILOR: { trade: "service", shops: [
    { name: "Masterji Tailors Chandni Chowk", owner: "Abdul Rehman", bio: "Suits, sherwanis and alterations." },
    { name: "Kinari Ladies Boutique", owner: "Meena Kapoor", bio: "Blouse stitching, lehengas and suits." },
    { name: "Royal Sherwani Tailors", owner: "Mohd Farooq", bio: "Wedding sherwanis and Indo-western outfits." },
    { name: "Perfect Fit Tailoring", owner: "Harpreet Singh", bio: "Shirts, trousers and quick alterations." },
    { name: "Nai Sarak Stitch Studio", owner: "Rubina Khan", bio: "Kurti, salwar and designer stitching." },
  ] },
  "Business Services": { trade: "service", shops: [
    { name: "Delhi-6 GST & Business Consultants", owner: "CA Nitin Goel", bio: "GST registration, returns and company setup." },
    { name: "Chawri Bazar Tax Point", owner: "Ashok Mittal", bio: "ITR filing, accounts and trade licences." },
    { name: "Startup Seva Kendra", owner: "Shivani Bansal", bio: "MSME, trademark and firm registration." },
    { name: "Old Delhi Documentation Centre", owner: "Mohd Imran", bio: "Shop licence, FSSAI and IEC help." },
    { name: "Bharat Business Solutions", owner: "Pradeep Arora", bio: "Bookkeeping and compliance for traders." },
  ] },
  "cop ret loyer": { trade: "service", shops: [
    { name: "Goel & Associates Corporate Law", owner: "Adv. Rakesh Goel", bio: "Company law, contracts and compliance." },
    { name: "Khan Legal Chambers", owner: "Adv. Salman Khan", bio: "Corporate disputes and agreements." },
    { name: "Jain Corporate Advisors", owner: "Adv. Priya Jain", bio: "Mergers, partnerships and business contracts." },
    { name: "Delhi-6 Business Law Firm", owner: "Adv. Anupam Mishra", bio: "Trademark, IP and corporate filings." },
    { name: "Capital Legal Partners", owner: "Adv. Nidhi Sharma", bio: "Startup legal setup and vendor agreements." },
  ] },
  loyer: { trade: "service", shops: [
    { name: "Adv. Mehmood Ali Law Office", owner: "Adv. Mehmood Ali", bio: "Property, civil and family matters." },
    { name: "Tis Hazari Legal Help Desk", owner: "Adv. Suresh Tyagi", bio: "Court cases, bail and legal notices." },
    { name: "Nyay Legal Services", owner: "Adv. Kavita Rani", bio: "Rent agreements, affidavits and notary." },
    { name: "Old Delhi Property Lawyers", owner: "Adv. Iqbal Hasan", bio: "Property documents and registry help." },
    { name: "Justice Point Advocates", owner: "Adv. Manish Verma", bio: "Consumer, cheque bounce and civil cases." },
  ] },
  "Offline marketing": { trade: "service", shops: [
    { name: "Chawri Bazar Printing & Flex", owner: "Vinod Gupta", bio: "Pamphlets, flex banners and visiting cards." },
    { name: "Delhi-6 Hoarding Ads", owner: "Shahnawaz Ali", bio: "Hoardings, shop boards and wall ads." },
    { name: "Print Point Nai Sarak", owner: "Rajat Jain", bio: "Brochures, catalogues and bulk printing." },
    { name: "Street Promo Services", owner: "Karan Malhotra", bio: "Leaflet distribution and event promotions." },
    { name: "Sign Craft Boards", owner: "Mohd Zubair", bio: "LED sign boards and glow sign boards." },
  ] },
  "Online marketing": { trade: "service", shops: [
    { name: "Digital Dilli Marketing", owner: "Aakash Arora", bio: "Google ads, SEO and local listings." },
    { name: "Clickwale Online Promotions", owner: "Sarah Qureshi", bio: "Facebook and Instagram ads for shops." },
    { name: "Old Delhi Web Growth", owner: "Nikhil Bansal", bio: "Websites and Google Business profile setup." },
    { name: "Leadify Marketing Studio", owner: "Hamza Siddiqui", bio: "Lead generation campaigns for traders." },
    { name: "Bazaar Digital Solutions", owner: "Ankit Goyal", bio: "WhatsApp marketing and online catalogues." },
  ] },
  "E-Commerce": { trade: "service", shops: [
    { name: "Chandni Chowk Online Sellers Hub", owner: "Vivek Agarwal", bio: "Amazon and Flipkart seller account setup." },
    { name: "Kinari Bazaar E-Store Services", owner: "Rehana Bano", bio: "Product listing and catalogue photography." },
    { name: "Delhi-6 Ecom Partners", owner: "Mayank Jain", bio: "Order management and shipping for online sellers." },
    { name: "Shopify Wala Old Delhi", owner: "Asif Iqbal", bio: "Online store setup for local businesses." },
    { name: "Meesho Seller Help Centre", owner: "Tanya Kapoor", bio: "Supplier onboarding and listing support." },
  ] },
  "Leads  Marketplace": { trade: "service", shops: [
    { name: "Trade Leads Delhi-6", owner: "Sachin Goel", bio: "Verified B2B buyer leads for wholesalers." },
    { name: "Bazaar Connect Leads", owner: "Mohd Arshad", bio: "Customer enquiries for local shops." },
    { name: "Wholesale Buyer Network", owner: "Ravi Bhatia", bio: "Bulk buyer leads for textiles and hardware." },
    { name: "Local Leads Point", owner: "Nazish Fatima", bio: "Service leads for home-service vendors." },
    { name: "Market Mitra Leads", owner: "Hemant Singhal", bio: "Enquiry sourcing for retailers." },
  ] },
  "social media account satup": { trade: "service", shops: [
    { name: "Insta Setup Studio Delhi-6", owner: "Riya Sharma", bio: "Instagram business account setup and branding." },
    { name: "Social Wala Old Delhi", owner: "Faisal Khan", bio: "Facebook page and WhatsApp Business setup." },
    { name: "Profile Pro Services", owner: "Aman Gupta", bio: "YouTube channel and social profile creation." },
    { name: "Brand Buzz Media", owner: "Zoya Mirza", bio: "Page design, bio and highlight covers." },
    { name: "Chandni Chowk Social Hub", owner: "Kunal Jain", bio: "Social media setup and first-month posting." },
  ] },
};

/** Stable pseudo-random number in [0, 1) from a string. */
function unit(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const pool = getPool();
const client = await pool.connect();
try {
  const { rows: cats } = await client.query(
    `select c.id, c.name, array_agg(ci.id) as item_ids
       from public.categories c join public.catalog_items ci on ci.category_id = c.id and coalesce(ci.is_active, true)
      where coalesce(c.is_active, true)
      group by c.id, c.name`,
  );
  const byName = new Map(cats.map((c) => [c.name as string, c as { id: string; name: string; item_ids: string[] }]));
  const missing = Object.keys(SHOPS).filter((n) => !byName.has(n));
  if (missing.length) console.log("skipping (category not found or no items):", missing.join(", "));

  await client.query("begin");
  let vendors = 0;
  let mappings = 0;
  let spotIndex = 0;
  for (const [catName, { trade, shops }] of Object.entries(SHOPS)) {
    const cat = byName.get(catName);
    if (!cat) continue;
    for (const s of shops) {
      const spot = SPOTS[spotIndex++ % SPOTS.length];
      const key = `delhi6:${s.name}`;
      const lat = +(spot.lat + (unit(`${key}:lat`) - 0.5) * 0.0012).toFixed(6);
      const lng = +(spot.lng + (unit(`${key}:lng`) - 0.5) * 0.0012).toFixed(6);
      const shopNo = 100 + Math.floor(unit(`${key}:no`) * 900);
      const rating = +(3.8 + unit(`${key}:r`) * 1.0).toFixed(1);
      const ratingCount = 8 + Math.floor(unit(`${key}:rc`) * 140);
      const { rows } = await client.query(
        `insert into public.vendors (id, user_id, business_name, owner_name, status, is_blocked, is_online, lat, lng,
                                     service_radius_km, operation_mode, city, state, pincode, address, trade, entity,
                                     shop_bio, onboarding_step, auto_accept_leads, verified, rating_avg, rating_count, updated_at)
         values (md5($1)::uuid, md5($1)::uuid, $2, $3, 'active', false, false, $4, $5,
                 5, 'fixed', 'Delhi', 'Delhi', '110006', $6, $7, 'Proprietorship',
                 $8, 3, false, false, $9, $10, now())
         on conflict (user_id) do update set
           business_name = excluded.business_name, owner_name = excluded.owner_name, lat = excluded.lat, lng = excluded.lng,
           address = excluded.address, trade = excluded.trade, shop_bio = excluded.shop_bio,
           rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, updated_at = now()
         returning user_id`,
        [key, s.name, s.owner, lat, lng, `Shop ${shopNo}, ${spot.street}, Chandni Chowk, Delhi 110006`, trade, s.bio, rating, ratingCount],
      );
      vendors++;
      const vendorId = rows[0].user_id as string;
      for (const itemId of cat.item_ids) {
        await client.query(
          `insert into public.vendor_item_mappings (id, vendor_id, item_id, is_active, updated_at)
           values (md5($1 || $2::text)::uuid, $3, $2::uuid, true, now())
           on conflict (vendor_id, item_id) do update set is_active = true, updated_at = now()`,
          [key, itemId, vendorId],
        );
        mappings++;
      }
    }
  }
  await client.query("commit");
  console.log(`seeded ${vendors} vendors and ${mappings} service mappings in Delhi-6`);
} catch (e) {
  await client.query("rollback").catch(() => null);
  throw e;
} finally {
  client.release();
  await pool.end();
}
