import puppeteer from 'puppeteer';
import { env } from '../config/env.js';
import { logger } from '../monitoring/logger.js';
import { assetRepository } from '../db/repositories/asset.repository.js';
import path from 'node:path';
import fs from 'node:fs/promises';

const log = logger.child({ module: 'infographic-renderer' });

export const InfographicRenderer = {
  /**
   * Render a beautiful single-page infographic PNG using Puppeteer.
   */
  async render(
    contentItemId: string,
    title: string,
    body: string,
    cta?: string | null
  ): Promise<string> {
    log.info({ contentItemId }, 'Rendering infographic PNG');

    // Parse bullet points or paragraphs from body text
    const paragraphs = body
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #090d16;
      color: #f8fafc;
      width: 1080px;
      height: 1350px;
      padding: 80px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
    }
    
    /* Background accents */
    body::before {
      content: '';
      position: absolute;
      top: -200px;
      left: -200px;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
    }
    body::after {
      content: '';
      position: absolute;
      bottom: -200px;
      right: -200px;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(192, 132, 252, 0.12) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 30px;
      z-index: 10;
    }

    .header .tag {
      background: linear-gradient(90deg, #6366f1 0%, #a855f7 100%);
      color: white;
      padding: 6px 16px;
      border-radius: 99px;
      font-size: 16px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
    }

    .header .logo {
      font-family: 'Outfit', sans-serif;
      font-weight: 800;
      font-size: 24px;
      color: #cbd5e1;
    }

    .main {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      margin-top: 40px;
      margin-bottom: 40px;
      z-index: 10;
    }

    .main h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 54px;
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 40px;
      background: linear-gradient(to right, #ffffff, #e2e8f0, #cbd5e1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .bullets {
      display: flex;
      flex-direction: column;
      gap: 30px;
    }

    .card {
      background: rgba(30, 41, 59, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-left: 5px solid #6366f1;
      padding: 24px 32px;
      border-radius: 12px;
      backdrop-filter: blur(10px);
      transition: all 0.3s ease;
    }

    .card:nth-child(even) {
      border-left-color: #a855f7;
    }

    .card p {
      font-size: 22px;
      line-height: 1.6;
      color: #e2e8f0;
      font-weight: 500;
    }

    .footer {
      border-top: 2px solid rgba(255, 255, 255, 0.05);
      padding-top: 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 10;
    }

    .footer .cta {
      font-size: 20px;
      font-weight: 600;
      color: #a5b4fc;
    }

    .footer .watermark {
      font-size: 16px;
      color: #64748b;
      font-weight: 500;
    }
  </style>
</head>
<body>

  <div class="header">
    <span class="tag">Insight Guide</span>
    <span class="logo">AGY</span>
  </div>

  <div class="main">
    <h1>${title}</h1>
    <div class="bullets">
      ${paragraphs
        .slice(0, 4) // Show up to 4 main cards
        .map(
          (para) => `
      <div class="card">
        <p>${para}</p>
      </div>
      `
        )
        .join('')}
    </div>
  </div>

  <div class="footer">
    <span class="cta">${cta || 'Join the discussion below ➔'}</span>
    <span class="watermark">LinkedIn Automation System</span>
  </div>

</body>
</html>
`;

    await fs.mkdir(env.ASSETS_DIR, { recursive: true });
    const imgFilename = `${contentItemId}-infographic.png`;
    const imgPath = path.join(env.ASSETS_DIR, imgFilename);

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1350 });
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' as any });

      // Take screenshot of the viewport
      await page.screenshot({
        path: imgPath,
        type: 'png',
      });

      log.info({ imgPath }, 'Infographic PNG successfully generated');

      // Record in assets table
      await assetRepository.create({
        contentItem: { connect: { id: contentItemId } },
        type: 'infographic',
        path: imgPath,
        mime: 'image/png',
      });

      return imgPath;
    } catch (err: any) {
      log.error({ err }, 'Puppeteer infographic render failed');
      throw err;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
};
