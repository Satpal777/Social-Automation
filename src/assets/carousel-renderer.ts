import puppeteer from 'puppeteer';
import { env } from '../config/env.js';
import { logger } from '../monitoring/logger.js';
import { assetRepository } from '../db/repositories/asset.repository.js';
import path from 'node:path';
import fs from 'node:fs/promises';

const log = logger.child({ module: 'carousel-renderer' });

export const CarouselRenderer = {
  /**
   * Render slides into a PDF file using Puppeteer and record in assets database.
   */
  async render(
    contentItemId: string,
    slides: Array<{ title: string; content: string }>,
    title = 'Technical Insights'
  ): Promise<string> {
    log.info({ contentItemId, slideCount: slides.length }, 'Rendering carousel PDF');

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Plus+Jakarta+Sans:wght@400;500;700&display=swap');
    
    @page {
      size: 1080px 1080px;
      margin: 0;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #0f172a;
      color: #f8fafc;
      -webkit-print-color-adjust: exact;
    }
    
    .slide {
      width: 1080px;
      height: 1080px;
      padding: 90px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      page-break-after: always;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      overflow: hidden;
    }

    .slide::before {
      content: '';
      position: absolute;
      top: -10%;
      right: -10%;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
    }
    
    /* Cover Slide */
    .slide.cover {
      justify-content: center;
      align-items: center;
      text-align: center;
      background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%);
    }
    
    .slide.cover .tag {
      background: rgba(99, 102, 241, 0.2);
      border: 1px solid rgba(99, 102, 241, 0.4);
      color: #818cf8;
      padding: 8px 16px;
      border-radius: 99px;
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 24px;
    }
    
    .slide.cover h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 64px;
      font-weight: 800;
      line-height: 1.15;
      background: linear-gradient(to right, #a5b4fc, #818cf8, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 32px;
      max-width: 900px;
    }
    
    .slide.cover .author {
      font-size: 20px;
      color: #94a3b8;
      font-weight: 500;
    }
    
    /* Standard Slide */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 20px;
    }
    
    .header .topic {
      font-size: 16px;
      color: #818cf8;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 1.5px;
    }
    
    .header .logo {
      font-family: 'Outfit', sans-serif;
      font-weight: 800;
      font-size: 20px;
      color: #f8fafc;
    }
    
    .content-body {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      margin-top: -20px;
    }
    
    .content-body h2 {
      font-family: 'Outfit', sans-serif;
      font-size: 42px;
      font-weight: 700;
      color: #f8fafc;
      margin-bottom: 28px;
      line-height: 1.25;
    }
    
    .content-body p {
      font-size: 24px;
      line-height: 1.6;
      color: #cbd5e1;
      font-weight: 400;
    }
    
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 20px;
      font-size: 16px;
      color: #64748b;
    }
    
    .footer .page-number {
      font-weight: 600;
      color: #94a3b8;
    }
  </style>
</head>
<body>

  <!-- Cover Slide -->
  <div class="slide cover">
    <div class="tag">Deep Dive</div>
    <h1>${title}</h1>
    <div class="author">Swipe to read ➔</div>
  </div>

  <!-- Content Slides -->
  ${slides
    .map(
      (slide, index) => `
  <div class="slide">
    <div class="header">
      <span class="topic">${title}</span>
      <span class="logo">AGY</span>
    </div>
    
    <div class="content-body">
      <h2>${slide.title}</h2>
      <p>${slide.content}</p>
    </div>
    
    <div class="footer">
      <span>LinkedIn Automation System</span>
      <span class="page-number">${index + 1} / ${slides.length}</span>
    </div>
  </div>
  `
    )
    .join('')}

</body>
</html>
`;

    // Ensure assets directory exists
    await fs.mkdir(env.ASSETS_DIR, { recursive: true });
    const pdfFilename = `${contentItemId}-carousel.pdf`;
    const pdfPath = path.join(env.ASSETS_DIR, pdfFilename);

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1080 });
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' as any });

      await page.pdf({
        path: pdfPath,
        width: '1080px',
        height: '1080px',
        printBackground: true,
        preferCSSPageSize: true,
      });

      log.info({ pdfPath }, 'Carousel PDF successfully generated');

      // Record in assets table
      await assetRepository.create({
        contentItem: { connect: { id: contentItemId } },
        type: 'pdf',
        path: pdfPath,
        mime: 'application/pdf',
        meta: { slideCount: slides.length + 1 } as any,
      });

      return pdfPath;
    } catch (err: any) {
      log.error({ err }, 'Puppeteer carousel render failed');
      throw err;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
};
