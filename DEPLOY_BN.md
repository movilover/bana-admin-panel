# BANA Admin Console — আলাদা GitHub Pages-এ ডিপ্লয় গাইড

## ১. লোকালি একবার চালিয়ে দেখুন (প্রস্তাবিত)
```
npm ci
npm run check
```
- `package-lock.json` দেওয়া আছে, তবে সেটা মূল প্রজেক্টের লক ফাইল থেকে অফলাইনে ছেঁটে বানানো এবং `npm ci` দিয়ে যাচাই করা হয়নি। `npm ci` ব্যর্থ হলে `npm install` চালান এবং নতুন `package-lock.json` commit করুন। GitHub workflow-ও `npm ci` ব্যর্থ হলে `npm install`-এ ফিরে যায়।
- `npm run check` এরর দিলে এরর লেখাটা পাঠান, ঠিক করে দেব।

## ২. নতুন GitHub রিপোজিটরি
1. নতুন রিপো বানান (যেমন `bana-admin`)। **আলাদা GitHub অ্যাকাউন্ট/org বা কাস্টম ডোমেইন** ব্যবহার করলে সবচেয়ে নিরাপদ (নিচে "নিরাপত্তা" দেখুন)।
2. এই ফোল্ডারের সব ফাইল (`.github` ফোল্ডারসহ) রিপোর `main` ব্রাঞ্চে push করুন।
3. রিপো → **Settings → Pages → Source = GitHub Actions**।
4. **Settings → Secrets and variables → Actions → Variables** এ যোগ করুন:
   - `VITE_BACKEND_URL` = আপনার Render ব্যাকএন্ডের URL (ইউজার সাইটে যেটা আছে, সেটাই)
   - `VITE_MEDIA_BROKER_URL` = ইউজার সাইটে যেটা আছে (না থাকলে খালি রাখুন)
   - `VITE_USER_SITE_URL` = ইউজার সাইটের URL (শেষে `/` ছাড়া) — "User site" ও "Open Profile" লিংকের জন্য
   - ঐচ্ছিক: `VITE_ADMIN_IDLE_MINUTES` (ডিফল্ট 30)
5. Actions ট্যাবে "Deploy BANA Admin Console" সফল হলে URL পাবেন: `https://<আপনার-নাম>.github.io/<রিপো-নাম>/`

## ৩. Firebase কনসোলে ডোমেইন অনুমোদন (না করলে লগইন হবে না)
Firebase Console → Authentication → Settings → **Authorized domains** → `<আপনার-নাম>.github.io` যোগ করুন
(পাথ ছাড়া শুধু ডোমেইন)।

## ৪. Render ব্যাকএন্ডে CORS অনুমতি
Render → ব্যাকএন্ড সার্ভিস → Environment → `CORS_ALLOWED_ORIGINS`-এ অ্যাডমিন সাইটের origin যোগ করুন (কমা দিয়ে):
`https://<আপনার-নাম>.github.io` — পাথ (`/bana-admin`) লিখবেন না। তারপর সার্ভিস redeploy করুন।

### ৪.১ Cloudflare media broker worker-এও CORS অনুমতি লাগবে
ইউজার সাইটের `workers/bana-media-broker`-এর নিজস্ব `ALLOWED_ORIGINS` ভেরিয়েবল আছে (ডিফল্ট: `bana-a5770.web.app`, `bana-a5770.firebaseapp.com`, `localhost:3000`)।
অ্যাডমিনের Storage Recovery ও API Management সেকশন এই ব্রোকার ডাকে। তাই Cloudflare ড্যাশবোর্ডে (বা `wrangler.toml`-এর `[vars]`-এ) `ALLOWED_ORIGINS`-এ অ্যাডমিন origin যোগ করুন
(`https://<আপনার-নাম>.github.io`, পাথ ছাড়া)। এটা না করলে ব্রাউজারে CORS এরর আসবে। (আমি কোনো ডিপ্লয় করিনি; পরিবর্তনটা আপনি নিজে করবেন।)

## ৫. প্রথম লগইন
- Super Admin: `src/firebase.ts`-এ `BOOTSTRAPPED_ADMIN_EMAIL` যে ইমেইল, সেই ইমেইল **verified** হতে হবে।
- অন্য স্টাফ: Super Admin প্যানেল থেকে রোল দিলে `adminRoles/{uid}` তৈরি হয়; তারপর সেই ইমেইলে লগইন করা যাবে।
- রোল না থাকলে "Authorized Admin Access Required" স্ক্রিন দেখাবে।

## ৬. নিরাপত্তা — জরুরি কথা
- GitHub Pages পাবলিক, কেউ চাইলে অ্যাডমিন কোড পড়তে পারবে। আসল সুরক্ষা **Firestore/Storage rules + রোল চেক**। রুলস ফাইল মূল প্রজেক্টেই আছে ও সেখান থেকেই ডিপ্লয় হবে; এই রিপোতে রুলস নেই।
- একই GitHub অ্যাকাউন্টের দুই রিপো একই origin (`<নাম>.github.io`) শেয়ার করে। তাই আলাদা অ্যাকাউন্ট/org বা কাস্টম ডোমেইন (যেমন `admin.yourdomain.com`) নিন।
  কাস্টম ডোমেইন নিলে Authorized domains ও CORS-এ সেই ডোমেইন যোগ করবেন।
- এই অ্যাপ ইউজার সাইটের লগইন সেশন পড়ে না: সেশন শুধু ট্যাব খোলা থাকা পর্যন্ত থাকে এবং ৩০ মিনিট নিষ্ক্রিয় থাকলে অটো লগআউট হয়।
- Firebase Console-এ অ্যাডমিন অ্যাকাউন্টগুলোর জন্য 2-Step Verification চালু রাখা ভালো।

## ৭. পরে আপডেট করলে
কোড পরিবর্তন `main`-এ push করলেই আবার অটো ডিপ্লয় হবে।
