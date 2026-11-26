import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { Sequelize } from 'sequelize';
import { createApp } from '../app.js';
import { defineModels } from '../models/index.js';

const jwtSecret = 'wishlist-coupon-integration-test-secret';
let sequelize;
let server;
let apiUrl;
let token;
let otherToken;
let product;
let models;

before(async () => {
  process.env.JWT_SECRET = jwtSecret;
  sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  models = defineModels(sequelize);
  await sequelize.sync();

  const user = await models.User.create({
    name: 'Test Customer',
    email: 'wishlist-test@example.com',
    password: 'not-used-by-this-test'
  });
  const otherUser = await models.User.create({
    name: 'Other Customer',
    email: 'other-wishlist-test@example.com',
    password: 'not-used-by-this-test'
  });
  product = await models.Product.create({
    name: 'Test Necklace',
    slug: 'test-necklace',
    original_price: 100,
    selling_price: 80
  });
  await models.Coupon.create({
    code: 'TEST10',
    type: 'percentage',
    value: 10,
    is_active: true
  });
  token = jwt.sign({ id: user.id, email: user.email, role: 'customer' }, jwtSecret);
  otherToken = jwt.sign({ id: otherUser.id, email: otherUser.email, role: 'customer' }, jwtSecret);

  server = createApp(models).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (sequelize) await sequelize.close();
});

test('wishlist persists per user and coupon endpoints return validated discounts', async () => {
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const unauthorized = await fetch(`${apiUrl}/wishlist`);
  assert.equal(unauthorized.status, 401);

  const added = await fetch(`${apiUrl}/wishlist`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ product_id: product.id })
  });
  assert.equal(added.status, 201);
  assert.equal((await added.json()).item.id, product.id);

  const addedAgain = await fetch(`${apiUrl}/wishlist`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ product_id: product.id })
  });
  assert.equal(addedAgain.status, 201);
  assert.equal(await models.Wishlist.count({ where: { product_id: product.id } }), 1);

  const loaded = await fetch(`${apiUrl}/wishlist`, { headers: authHeaders });
  const wishlist = await loaded.json();
  assert.equal(loaded.status, 200);
  assert.equal(wishlist.items.length, 1);
  assert.equal(wishlist.items[0].id, product.id);

  const otherWishlist = await fetch(`${apiUrl}/wishlist`, {
    headers: { Authorization: `Bearer ${otherToken}` }
  });
  assert.deepEqual((await otherWishlist.json()).items, []);

  const couponResponse = await fetch(`${apiUrl}/coupons/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'test10',
      subtotal: 80,
      items: [{ product_id: product.id, price: 80, quantity: 1 }]
    })
  });
  const couponResult = await couponResponse.json();
  assert.equal(couponResponse.status, 200);
  assert.equal(couponResult.success, true);
  assert.equal(couponResult.discount_amount, 8);

  const invalidCoupon = await fetch(`${apiUrl}/coupons/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'INVALID', subtotal: 80 })
  });
  assert.equal(invalidCoupon.status, 404);
  assert.equal((await invalidCoupon.json()).success, false);

  const removed = await fetch(`${apiUrl}/wishlist/${product.id}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  assert.equal(removed.status, 200);

  const reloaded = await fetch(`${apiUrl}/wishlist`, { headers: authHeaders });
  assert.deepEqual((await reloaded.json()).items, []);
});
