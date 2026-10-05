require('dotenv').config();
const mongoose = require('mongoose');

async function testResolution() {
  await mongoose.connect(process.env.MONGO_URI);
  const Email = require('../src/modules/mail-router/mongoose/models/Email');
  const MailAccount = require('../src/modules/mail-router/mongoose/models/MailAccount');
  const zohoAcc = await MailAccount.findOne({ provider: 'ZOHO' }).lean();
  const token = zohoAcc.accessToken;
  const baseUrl = 'https://mail.zoho.com/api';
  const accountId = zohoAcc.providerUserId;

  const emails = await Email.find({
    provider: 'ZOHO',
    bodyHtml: { $regex: 'A red triangle shaped object', $options: 'i' }
  });
  console.log('Found emails with red triangle:', emails.length);
  for (const email of emails) {
    console.log(' -', email.subject, '| id:', email._id, '| msgId:', email.providerMessageId);
  }

  const sample = emails[0];
  if (sample) {
    // Look for all img tags in sample.bodyHtml
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = imgRegex.exec(sample.bodyHtml)) !== null) {
      console.log('\nFound img tag with src:', m[1]);
      const urlStr = m[1].replace(/&amp;/g, '&');
      if (urlStr.includes('ImageDisplay')) {
        const q = new URLSearchParams(urlStr.split('?')[1]);
        const cid = q.get('cid');
        const f = q.get('f');
        console.log('Extracted params:', { cid, f });

        // Download from Zoho API
        const folderId = '4819676000000008008';
        const dlUrl = `${baseUrl}/accounts/${accountId}/folders/${folderId}/messages/${sample.providerMessageId}/inline?contentId=${encodeURIComponent(cid)}`;
        const res = await fetch(dlUrl, {
          headers: { Authorization: 'Zoho-oauthtoken ' + token }
        });
        console.log('Download status:', res.status, 'content-type:', res.headers.get('content-type'));
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          console.log('Downloaded bytes:', buf.length);
          const mime = res.headers.get('content-type')?.split(';')[0] || (f.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
          const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
          console.log('Generated data URI length:', dataUri.length, 'sample:', dataUri.slice(0, 40));
        }
      }
    }
  }

  await mongoose.disconnect();
}
testResolution().catch(console.error);
