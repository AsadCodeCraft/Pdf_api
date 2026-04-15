const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
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
let browserInstancePromise = null;

function ensureLocalPdfDirectory() {
  if (!fs.existsSync(pdfDirectory)) {
    fs.mkdirSync(pdfDirectory, { recursive: true });
  }
}

async function getBrowser() {
  if (!browserInstancePromise) {
    browserInstancePromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  return browserInstancePromise;
}

async function closeBrowser() {
  if (!browserInstancePromise) {
    return;
  }

  const browser = await browserInstancePromise;
  browserInstancePromise = null;
  await browser.close();
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
    printBackground: true,
    preferCSSPageSize: true,
    ...options
  };
}

async function renderPdfBuffer(html, options = {}) {
  if (!html) {
    const error = new Error('HTML content is required');
    error.statusCode = 400;
    throw error;
  }

  const pdfOptions = getPdfOptions(options);
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, {
      waitUntil: ['domcontentloaded', 'networkidle0']
    });

    await page.emulateMediaType('print');

    return await page.pdf({
      format: pdfOptions.format,
      landscape: Boolean(pdfOptions.landscape),
      printBackground: pdfOptions.printBackground !== false,
      preferCSSPageSize: pdfOptions.preferCSSPageSize !== false,
      margin: pdfOptions.margin,
      displayHeaderFooter: Boolean(pdfOptions.displayHeaderFooter),
      headerTemplate: pdfOptions.headerTemplate || '<span></span>',
      footerTemplate: pdfOptions.footerTemplate || '<span></span>'
    });
  } finally {
    await page.close();
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
