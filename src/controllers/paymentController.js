import crypto from 'crypto';
import Razorpay from 'razorpay';
import { validateCouponForOrder } from '../services/couponValidationService.js';

export const createPaymentOrder = (models) => async (req, res) => {
  try {
    const { amount, total_amount, currency = 'INR', receipt, order_id } = req.body;

    let authoritativeAmount = amount !== undefined ? amount : total_amount;

    // Look up DB order by order_id or receipt (order_number) to enforce authoritative total and revalidate coupon
    let dbOrder = null;
    if (order_id) {
      const isNum = !isNaN(order_id);
      dbOrder = await models.Order.findOne({
        where: isNum ? { id: parseInt(order_id, 10) } : { order_number: String(order_id) },
        include: models.OrderItem ? [{ model: models.OrderItem, as: 'items' }] : []
      });
    } else if (receipt) {
      dbOrder = await models.Order.findOne({
        where: { order_number: String(receipt) },
        include: models.OrderItem ? [{ model: models.OrderItem, as: 'items' }] : []
      });
    }

    if (dbOrder && dbOrder.payment_status !== 'paid') {
      if (dbOrder.coupon_code) {
        // Revalidate coupon against latest DB status before initiating Razorpay payment
        // Note: usage_count was already incremented on order creation if valid, so we pass a flag or check is_active/expiry
        const coupon = await models.Coupon.findOne({
          where: { code: dbOrder.coupon_code.trim().toUpperCase() }
        });
        const now = new Date();
        const isDisabledOrExpired =
          !coupon ||
          !coupon.is_active ||
          (coupon.start_date && new Date(coupon.start_date) > now) ||
          (coupon.expiry_date && new Date(coupon.expiry_date) < now);

        if (isDisabledOrExpired) {
          dbOrder.coupon_code = null;
          dbOrder.discount = 0;
          dbOrder.total_amount = Math.max(0, parseFloat(dbOrder.subtotal) + parseFloat(dbOrder.shipping_fee || 0));
          await dbOrder.save();

          return res.status(400).json({
            success: false,
            couponInvalid: true,
            updatedTotal: parseFloat(dbOrder.total_amount),
            message: 'This coupon has expired or is no longer available. Your order total has been updated.'
          });
        }
      }
      authoritativeAmount = parseFloat(dbOrder.total_amount);
    }

    const num = parseFloat(authoritativeAmount);
    const amountInPaise = Math.max(100, Math.round((Number.isFinite(num) ? num : 100) * 100));

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    // If real keys provided
    if (keyId && keySecret && !keyId.includes('rzp_test_ethnic_edit')) {
      try {
        const instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
        const options = {
          amount: amountInPaise, // in paise
          currency,
          receipt: receipt ? String(receipt).slice(-40) : `rec_${Date.now()}`
        };
        const order = await instance.orders.create(options);
        return res.json({ success: true, order, keyId });
      } catch (rzpErr) {
        console.warn('Razorpay API error, falling back to simulator:', rzpErr.message);
      }
    }

    // Test / Dev Simulation Order
    const simulatedOrder = {
      id: `order_sim_${Date.now()}`,
      entity: 'order',
      amount: amountInPaise,
      amount_paid: 0,
      amount_due: amountInPaise,
      currency,
      receipt: receipt ? String(receipt).slice(-40) : `rec_${Date.now()}`,
      status: 'created',
      created_at: Math.floor(Date.now() / 1000)
    };

    return res.json({
      success: true,
      order: simulatedOrder,
      keyId: keyId || 'rzp_test_ethnic_edit_2026',
      is_simulation: true
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to create payment order.', error: error.message });
  }
};

export const verifyPayment = (models) => async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      order_id
    } = req.body;

    if (!order_id) {
      return res.status(400).json({ success: false, message: 'Order ID is required for verification.' });
    }

    const isNumeric = !isNaN(order_id);
    const where = isNumeric ? { id: parseInt(order_id, 10) } : { order_number: String(order_id) };

    const order = await models.Order.findOne({ where });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Verify signature if real secret configured
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (keySecret && !keySecret.includes('ethnic_edit_secret_key_test') && razorpay_signature && razorpay_order_id && razorpay_payment_id) {
      try {
        const generatedSignature = crypto
          .createHmac('sha256', keySecret)
          .update(`${razorpay_order_id}|${razorpay_payment_id}`)
          .digest('hex');

        if (generatedSignature !== razorpay_signature) {
          order.payment_status = 'failed';
          await order.save();
          return res.status(400).json({ success: false, message: 'Payment verification failed: Signature mismatch.' });
        }
      } catch (sigErr) {
        console.warn('Signature verification check error:', sigErr.message);
      }
    }

    // Mark order as paid and confirmed
    order.payment_status = 'paid';
    order.order_status = 'Confirmed';
    order.notes = `Razorpay Payment ID: ${razorpay_payment_id || 'test_pay_' + Date.now()}`;
    await order.save();

    return res.json({
      success: true,
      message: 'Payment verified and confirmed!',
      order
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Payment verification error.', error: error.message });
  }
};

