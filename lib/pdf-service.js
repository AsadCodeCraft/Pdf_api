const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const pdfDirectory = path.join(process.cwd(), 'generated-pdfs');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || 'pdfs';
const supabaseBucketPublic = process.env.SUPABASE_BUCKET_PUBLIC !== 'false';
const signedUrlExpiresIn = Number(process.env.SUPABASE_SIGNED_URL_EXPIRES_IN || 3600);
const useSupabaseStorage = Boolean(supabaseUrl && supabaseServiceRoleKey);

const supabase = useSupabaseStorage
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

let browserPromise = null;

function ensureLocalPdfDirectory() {
  if (!fs.existsSync(pdfDirectory)) {
    fs.mkdirSync(pdfDirectory, { recursive: true });
  }
}

async function getPuppeteerBundle() {
  if (process.env.VERCEL) {
    const chromium = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');
    return { chromium, puppeteer };
  }

  const puppeteer = require('puppeteer');
  return { chromium: null, puppeteer };
}

async function initBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium, puppeteer } = await getPuppeteerBundle();

      if (process.env.VERCEL) {
        const executablePath = await chromium.executablePath();
        return puppeteer.launch({
          args: chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath,
          headless: chromium.headless,
          ignoreHTTPSErrors: true
        });
      }

      return puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      });
    })().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }

  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) {
    return;
  }

  try {
    const browser = await browserPromise;
    await browser.close();
  } finally {
    browserPromise = null;
  }
}

async function storePdf(fileName, pdfBuffer, requestOrigin) {
  if (supabase) {
    const storagePath = `generated/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from(supabaseBucket)
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    if (supabaseBucketPublic) {
      const { data } = supabase.storage.from(supabaseBucket).getPublicUrl(storagePath);
      return {
        fileName,
        storage: 'supabase',
        path: storagePath,
        url: data.publicUrl,
        expiresIn: null
      };
    }

    const { data, error: signedUrlError } = await supabase.storage
      .from(supabaseBucket)
      .createSignedUrl(storagePath, signedUrlExpiresIn);

    if (signedUrlError) {
      throw signedUrlError;
    }

    return {
      fileName,
      storage: 'supabase',
      path: storagePath,
      url: data.signedUrl,
      expiresIn: signedUrlExpiresIn
    };
  }

  ensureLocalPdfDirectory();
  const filePath = path.join(pdfDirectory, fileName);
  fs.writeFileSync(filePath, pdfBuffer);

  return {
    fileName,
    storage: 'local',
    path: filePath,
    url: `${requestOrigin}/pdfs/${fileName}`,
    expiresIn: null
  };
}

function getPdfOptions(options = {}) {
  return {
    format: 'A4',
    margin: {
      top: '10mm',
      right: '10mm',
      bottom: '10mm',
      left: '10mm'
    },
    ...options
  };
}

async function renderPdfBuffer(html, options = {}) {
  if (!html) {
    const error = new Error('HTML content is required');
    error.statusCode = 400;
    throw error;
  }

  const browser = await initBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle2' });
    return Buffer.from(await page.pdf(getPdfOptions(options)));
  } finally {
    await page.close();
  }
}

async function convertHtmlToPdfUrl(html, options = {}, requestOrigin) {
  const pdfBuffer = await renderPdfBuffer(html, options);
  const fileName = `document-${Date.now()}-${crypto.randomUUID()}.pdf`;
  return storePdf(fileName, pdfBuffer, requestOrigin);
}

async function convertHtmlToBase64(html, options = {}) {
  const pdfBuffer = await renderPdfBuffer(html, options);
  return {
    success: true,
    pdf: pdfBuffer.toString('base64'),
    mimeType: 'application/pdf'
  };
}

module.exports = {
  closeBrowser,
  convertHtmlToBase64,
  convertHtmlToPdfUrl,
  ensureLocalPdfDirectory,
  getPdfOptions,
  pdfDirectory,
  useSupabaseStorage,
  supabaseBucket
};
