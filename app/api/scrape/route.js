import { chromium } from "playwright";
import { parsePhoneNumberFromString } from "libphonenumber-js";

// ---------------- Helpers ----------------
function getPrimaryEmail(emails) {
  emails = [...new Set(emails.map((e) => e.toLowerCase()))]
    .map((e) => e.split("?")[0].trim())
    .filter((e) => !e.endsWith(".png") && !e.endsWith(".jpg") && e.includes("@"));

  const priority = ["info@", "contact@", "support@"];
  for (let p of priority) {
    const found = emails.find((e) => e.startsWith(p));
    if (found) return found;
  }
  return emails[0] || null;
}

function filterValidPhones(phones) {
  const valid = [];
  phones.forEach((p) => {
    try {
      const phoneObj = parsePhoneNumberFromString(p, "ZZ");
      if (phoneObj && phoneObj.isValid()) valid.push(phoneObj.formatInternational());
    } catch {}
  });
  return [...new Set(valid)];
}

function getCompanyNameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const name = hostname.split(".")[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return null;
  }
}

async function extractDataFromPage(page) {
  try {
    return await page.evaluate(() => {
      const result = { emails: [], phones: [], social: {} };
      const elements = Array.from(document.querySelectorAll("a, p, span, div , ul , li"));

      elements.forEach((el) => {
        const text = el.innerText || "";
        const href = el.getAttribute("href") || "";

        // Emails
        if (href.startsWith("mailto:")) result.emails.push(href.replace("mailto:", "").trim());
        const emailMatch = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
        if (emailMatch) result.emails.push(emailMatch[0]);

        // Phones: prioritize href="tel:" first
        if (href.startsWith("tel:")) {
          result.phones.push(href.replace("tel:", "").trim());
        } else {
          const phoneMatch = text.match(/(\+?\d[\d\s\-()]{6,})/);
          if (phoneMatch) result.phones.push(phoneMatch[0].trim());
        }
      });

      // Social Links
      const links = Array.from(document.querySelectorAll("a[href]"));
      links.forEach((a) => {
        const href = a.href;
        if (!href) return;

        if (/facebook\.com/i.test(href) && !/sharer\.php/i.test(href) && !/\?/.test(href))
          result.social.facebook = href;
        if (/instagram\.com/i.test(href) && !/\?/.test(href)) result.social.instagram = href;
        if (/linkedin\.com/i.test(href) && !/shareArticle/i.test(href) && /linkedin\.com\/(company|in)\//i.test(href))
          result.social.linkedin = href;
      });

      return result;
    });
  } catch {
    return { emails: [], phones: [], social: {} };
  }
}

// ---------------- Main Scraper ----------------
export async function POST(req) {
  try {
    const { urls } = await req.json();
    if (!urls || !Array.isArray(urls) || urls.length === 0)
      return Response.json({ error: "URLs array is required" }, { status: 400 });

    const browser = await chromium.launch({ headless: true });
    const results = [];
    const concurrency = 10;
    let activeCount = 0;
    let index = 0;

    async function scrapeUrl(url) {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      const companyName = getCompanyNameFromUrl(url);
      let data = { emails: [], phones: [], social: {} };

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 420000 }); // 7 minutes
        await page.waitForTimeout(1000);
        const homeData = await extractDataFromPage(page);
        data.emails.push(...homeData.emails);
        data.phones.push(...homeData.phones);
        data.social = { ...data.social, ...homeData.social };
      } catch (err) {
        console.warn(`Failed homepage scrape for ${url}: ${err.message}`);
      }

      // Internal links containing contact-like pages
      let internalLinks = [];
      try {
        internalLinks = await page.evaluate(() => {
          const keywords = ["cont", "join", "care", "priv"];
          return Array.from(document.querySelectorAll("a[href]"))
            .map((a) => a.href)
            .filter(
              (href) => href && keywords.some((k) => href.toLowerCase().includes(k)) && !href.includes("mailto:")
            );
        });
      } catch {}

      for (const link of internalLinks) {
        const linkPage = await context.newPage();
        try {
          await linkPage.goto(link, { waitUntil: "domcontentloaded", timeout: 420000 });
          await linkPage.waitForTimeout(1000);
          const linkData = await extractDataFromPage(linkPage);
          data.emails.push(...linkData.emails);
          data.phones.push(...linkData.phones);
          data.social = { ...data.social, ...linkData.social };
        } catch (err) {
          console.warn(`Failed internal link ${link}: ${err.message}`);
        } finally {
          await linkPage.close();
        }
      }

      // Explicit /contact/ page
      try {
        const contactPage = url.endsWith("/") ? url + "contact/" : url + "/contact/";
        const contactPageObj = await context.newPage();
        await contactPageObj.goto(contactPage, { waitUntil: "domcontentloaded", timeout: 420000 });
        await contactPageObj.waitForTimeout(1000);
        const contactData = await extractDataFromPage(contactPageObj);
        data.emails.push(...contactData.emails);
        data.phones.push(...contactData.phones);
        data.social = { ...data.social, ...contactData.social };
        await contactPageObj.close();
      } catch {}

      // Deduplicate & validate
      const primaryEmail = getPrimaryEmail(data.emails);
      data.emails = primaryEmail ? [primaryEmail] : [];
      data.phones = filterValidPhones(data.phones).slice(0, 1);
      if (data.social.linkedin) {
        const match = data.social.linkedin.match(/(https?:\/\/www\.linkedin\.com\/company\/[a-zA-Z0-9-_]+)/i);
        if (match) data.social.linkedin = match[1];
      }

      const hasData =
        (data.emails && data.emails.length) ||
        (data.phones && data.phones.length) ||
        (data.social && Object.keys(data.social).length);

      if (hasData) results.push({ url, companyName, data });

      await page.close();
      await context.close();
    }

    async function runQueue() {
      const promises = [];
      while (index < urls.length) {
        if (activeCount < concurrency) {
          const url = urls[index++];
          activeCount++;
          const p = scrapeUrl(url)
            .catch((err) => console.error(`Failed scrape for ${url}:`, err.message))
            .finally(() => activeCount--);
          promises.push(p);
        } else {
          await new Promise((res) => setTimeout(res, 100));
        }
      }
      await Promise.all(promises);
    }

    await runQueue();
    await browser.close();

    return Response.json({ results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}