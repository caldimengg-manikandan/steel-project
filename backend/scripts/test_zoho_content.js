require('dotenv').config();
const mongoose = require('mongoose');

async function testZohoContentEndpoints() {
  await mongoose.connect(process.env.MONGO_URI);
  const MailAccount = require('../src/modules/mail-router/mongoose/models/MailAccount');
  const zohoAcc = await MailAccount.findOne({ provider: 'ZOHO' }).lean();
  const token = zohoAcc.accessToken;
  const baseUrl = 'https://mail.zoho.com/api';
  const accountId = zohoAcc.providerUserId;
  const messageId = '1782888275346143900';
  const folderId = '4819676000000008008';

  console.log('--- 1. Testing /details ---');
  const detailsRes = await fetch(`${baseUrl}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/details`, {
    headers: { Authorization: 'Zoho-oauthtoken ' + token }
  });
  console.log('details status:', detailsRes.status);
  const detailsJson = await detailsRes.json();
  console.log('details keys:', Object.keys(detailsJson.data || {}));
  console.log('details sample:', JSON.stringify(detailsJson.data, null, 2).slice(0, 1000));

  console.log('\n--- 2. Testing /content ---');
  const contentRes = await fetch(`${baseUrl}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/content`, {
    headers: { Authorization: 'Zoho-oauthtoken ' + token }
  });
  console.log('content status:', contentRes.status);
  const contentJson = await contentRes.json();
  const html = contentJson.data?.content || '';
  console.log('content length:', html.length);
  // Look for img tags in html
  const imgMatches = html.match(/<img[^>]+>/gi) || [];
  console.log('img tags in /content response:', imgMatches);

  console.log('\n--- 3. Testing ImageDisplay with Bearer vs Zoho-oauthtoken vs query param ---');
  // How does Zoho authenticate ImageDisplay?
  // Let's test if passing apiKey or token or authorization header works
  const imgTag = imgMatches[0];
  const srcMatch = imgTag?.match(/src="([^"]+)"/i);
  if (srcMatch) {
    const rawSrc = srcMatch[1].replace(/&amp;/g, '&');
    console.log('Testing rawSrc:', rawSrc);

    // Try 1: mail.zoho.com/api + rawSrc
    const t1 = await fetch(`https://mail.zoho.com/api${rawSrc}`, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token }
    });
    console.log('t1 (/api/mail/ImageDisplay):', t1.status, t1.headers.get('content-type'));

    // Try 2: mail.zoho.com + rawSrc with Zoho-oauthtoken
    const t2 = await fetch(`https://mail.zoho.com${rawSrc}`, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token }
    });
    console.log('t2 (mail.zoho.com/mail/ImageDisplay with Zoho-oauthtoken):', t2.status, t2.headers.get('content-type'));

    // Try 3: mail.zoho.com + rawSrc with Bearer token
    const t3 = await fetch(`https://mail.zoho.com${rawSrc}`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    console.log('t3 (mail.zoho.com/mail/ImageDisplay with Bearer):', t3.status, t3.headers.get('content-type'));

    // Try 4: Check if Zoho has an api for inline images
    // e.g. /accounts/{accountId}/folders/{folderId}/messages/{messageId}/inlineimages or /attachments
    // Extract query params from rawSrc:
    const qParams = new URLSearchParams(rawSrc.split('?')[1]);
    const f = qParams.get('f');
    const cid = qParams.get('cid');
    console.log('Params:', { f, cid, messageId, folderId });

    // Try 4a: /accounts/{accountId}/folders/{folderId}/messages/{messageId}/attachments
    const t4 = await fetch(`${baseUrl}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/attachments`, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token }
    });
    console.log('t4 (/attachments):', t4.status, await t4.text());

    // Try 4b: /accounts/{accountId}/folders/{folderId}/messages/{messageId}/attachmentinfo?includeInline=true or mode=inline
    const t5 = await fetch(`${baseUrl}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/attachmentinfo?includeInline=true&mode=inline`, {
      headers: { Authorization: 'Zoho-oauthtoken ' + token }
    });
    console.log('t5 (attachmentinfo with params):', t5.status, await t5.text());
  }

  await mongoose.disconnect();
}
testZohoContentEndpoints().catch(console.error);
