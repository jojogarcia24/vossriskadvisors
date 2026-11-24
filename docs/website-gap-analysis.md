# Website gap analysis: vossriskadvisors.com

_November 2026. A page-by-page scan of the live single-page site (`public/index.html`), compared with what national and digital-first insurance brands offer: Lemonade, Kin, Hippo, Policygenius, Goosehead, Chubb/PURE private client, and the better State Farm/Allstate agent sites._

**Bottom line:** the brand looks right. The navy, gold, and serif styling reads as premium, which suits older and affluent clients. The site feels plain for three reasons: (1) it says very little that proves Voss is real and trusted, (2) almost nothing on it responds when you click or tap, and (3) it has gaps in coverage and channels that younger buyers and wealthy households look for first.

---

## Shipped in this PR

| Change | Why |
|---|---|
| Photo header on every coverage card (home and Coverage page), with a floating icon badge, image zoom and lift on hover | Your request. Photos make the cards feel high-end instead of looking like a template |
| Photos on the four built-in Resources guide cards | They showed a generic "article" icon |
| "Start a quote in one tap" chips in the hero (Home, Auto, Home + Auto, Rental, Business, Life) | Gen Z and millennials expect one tap to start. The chip opens the quote form with that coverage already selected |
| Every "Request a quote" button on a coverage page now pre-selects that coverage | Visitors no longer have to pick it again |
| The Coverage page picker is now a **60-second coverage checkup**. Visitors tap every situation that fits (own a home, teen driver, 1099, etc.), see the coverages worth a look, and can quote them all in one request | An interactive tool, and it naturally leads to bundling |
| 3-step "How it works" strip under the hero | Older buyers want to know the process before they call |
| **Deep links and back button.** Links like `/#auto` now open the Auto page, and the browser Back button works | Before this, every link in `sitemap.xml` (`/#coverage`, `/#life`…) landed on the home page, and Back left the site |
| Back-to-top button, a reading progress bar on articles, keyboard access on cards | Polish and accessibility |
| Fixed the "Coverage" menu item, which used a different font and size from the rest of the nav | Visible in the screenshot you sent |
| Darker body-text gray (contrast 3.7:1 → 5.7:1, passes WCAG AA) | The light gray was hard to read for older visitors |
| Smaller, compressed card images (`/img/cards/`, about 30–80 KB each) | Keeps the photo grid fast on phones |

---

## Update: second round (also in this PR)

Done: **Renters**, **Umbrella** (with a calculator), and **Private Client** pages · the placeholder testimonials replaced by an honest "Our promise to you" section · stats band replaced with real figures (10 coverage lines, 1-day response, $0 to compare, P&C + Life & Health licensed) · Privacy, Terms, and Accessibility pages rewritten (texting, AI chat, licensing) with the "Template" notices removed · footer, emails, and schema now list **Life, Accident & Health** · **social share image** (`og:image`) · **AI chat assistant** that answers questions and captures leads · **Text us** in the header, mobile bar, contact page, footer, and chat · **3-step quote form** with progress bar, multi-select coverage, and contact preference · **FEMA flood-zone lookup** and **renters/umbrella calculators** · **every page has its own URL** (`/renters`, `/resources/<article>`) with its own title, description, canonical link, breadcrumbs, a generated sitemap, and a 404 page · embedded images moved to files (page weight 1.3 MB → about 180 KB).

Still open: Google reviews (once you have clients, see below), an advisor photo or video, carrier logos, policy service request forms, life-stage guides, Spanish.

**Getting reviews from zero:** create or claim the Google Business Profile for 13155 Noel Rd, then ask every new client for a review after they bind, with a direct review link in the thank-you email. Don't buy or swap reviews; Google and the FTC prohibit it.

## Fix first: trust problems on the live site (fixed in this PR)

1. **The testimonials are labeled "Client testimonial · placeholder"** on the home page. This is the most damaging thing on the site. Replace them with real Google reviews (with permission) or remove the section until you have some.
2. **The stats band ("Many / 1:1 / TX / 100%")** looks like filler. Use real numbers: carrier appointments (e.g. "20+ carriers"), typical quote turnaround ("Same-day quotes"), Google rating, and the year licensed.
3. **The Privacy, Terms, and Accessibility pages say "Template — have counsel review before launch"** where visitors can see it.
4. **The footer license line only says "Property & Casualty"**, but the site sells Life and Disability. Add "Life, Accident & Health".
5. **No social preview image.** There's no `og:image`, so a link shared by text, iMessage, LinkedIn, or Instagram shows a blank card. Younger referrals travel this way.
6. **The email address isn't clickable** (it should be a `mailto:` link), and **Book a call** is missing from the desktop menu.

## What competitors have that Voss doesn't

### Coverage lines (the biggest gap for both ends of your audience)
- **Gen Z / millennials:** **renters** (their first insurance purchase and the way they come in the door), **condo**, **motorcycle**, **pet**, and possibly travel.
- **Wealthy households:** **personal umbrella**, **high-value homes**, **jewelry, art, watches, and collectibles** (scheduled items), **boat/watercraft**, **RV**, and **classic or exotic cars**. Chubb, PURE, and private-client agents organize this as a single **"Private Client"** page. That one page would signal "we handle complex, high-net-worth households."
- **Texas-specific:** hail and roof coverage, wind/hail deductibles, and freeze damage. Every Texas homeowner searches for these.

### Ways to reach you
- **Text us** (`sms:` link). Younger buyers would rather text than call.
- **Live chat or an AI assistant** after hours. You already run Claude in the admin tools, so a client-facing "Ask a question" widget is a realistic next step.
- **Spanish-language pages, or at least "Hablamos Español"** if you can serve Spanish speakers. That's a large share of DFW households, and local Goosehead and State Farm agents advertise it.
- **Social links** in the footer: Instagram, TikTok, LinkedIn, Facebook, and your Google Business Profile.

### Tools and interactivity
- **A step-by-step quote flow** (one question per screen with a progress bar) instead of a single long form. Lemonade and Kin set this expectation. It usually raises completion rates.
- **Address autocomplete** on the quote form.
- **More calculators:** home replacement-cost estimator, "How much umbrella do I need?", and a **flood-risk lookup** by address (links to FEMA's map).
- **Policyholder service requests:** add a driver or vehicle, request ID cards, request a certificate of insurance (COI) for commercial clients, change of address. The Claims page covers part of this but has no request forms.

### Proof and personality
- **Google reviews widget** with your star rating.
- **A real photo or a 30–60 second intro video from JoJo** on Home and About. People buy from an advisor they can see. The About page currently shows the logo in a frame.
- **Carrier logos** instead of text names in the scrolling band (get each carrier's permission and follow their brand rules).
- Membership badges, if they apply: Trusted Choice / Big I, BBB, local chamber of commerce.

### Content by life stage (works for every age group)
Short guide pages for "Just bought a home", "New teen driver", "Getting married", "Having a baby", "Starting a business", "Retiring / downsizing". Each one links to the coverages it needs and to the checkup.

### SEO structure
Everything is one HTML file, and the pages are `#hash` sections. Google treats that as **one page**, so "/#homeowners" won't rank on its own for "homeowners insurance Dallas." The biggest long-term growth step is to give each coverage line its own real URL (`/homeowners`, `/auto`…) with its own title, description, and FAQ schema. This is a larger rebuild; ask for it as a separate project.

### Minor
- On phones under 860px, two sticky bottom bars (`.callbar` and `.mcta-bar`) both render and overlap. Keep one.
- Much of the copy uses font-weight 300 at 13–15px. For older readers, use a 16px minimum and weight 400 for body text.

---

## Suggested order

1. **This week:** replace or remove the placeholder testimonials, fix the stats, update the footer license line, add `og:image`, add Text-us and social links.
2. **Next:** Renters, Umbrella, and a Private Client page. Add a Google reviews widget and an advisor photo or video.
3. **Then:** the step-by-step quote flow, policy service request forms, life-stage guides, and Spanish.
4. **Bigger project:** separate URLs per page for SEO.
