import { validateCouponForOrder } from '../services/couponValidationService.js';

export const applyCoupon = (models) => async (req, res) => {
  try {
    const { code, subtotal, items } = req.body;

    const result = await validateCouponForOrder(models, {
      code,
      subtotal,
      items: Array.isArray(items) ? items : [],
      userId: req.user?.id || null
    });

    if (!result.valid) {
      return res.status(result.status || 400).json({
        success: false,
        reason: result.reason,
        message: result.message
      });
    }

    const { coupon, discount } = result;

    return res.json({
      success: true,
      message: 'Coupon applied successfully!',
      discount_amount: discount,
      discount: discount,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        discount_amount: discount,
        discount
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to apply coupon.', error: error.message });
  }
};

export const adminGetCoupons = (models) => async (req, res) => {
  try {
    const coupons = await models.Coupon.findAll({
      order: [['createdAt', 'DESC']]
    });
    return res.json({ success: true, coupons });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch coupons.', error: error.message });
  }
};

export const createCoupon = (models) => async (req, res) => {
  try {
    const {
      code,
      type = 'percentage',
      value,
      min_order_value = 0,
      max_discount,
      usage_limit = 100,
      per_user_limit = null,
      start_date = null,
      expiry_date,
      applicable_products = null,
      applicable_categories = null,
      is_active = true
    } = req.body;

    if (!code || value === undefined) {
      return res.status(400).json({ success: false, message: 'Coupon code and discount value are required.' });
    }

    const existing = await models.Coupon.findOne({ where: { code: code.trim().toUpperCase() } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A coupon with this code already exists.' });
    }

    const coupon = await models.Coupon.create({
      code: code.trim().toUpperCase(),
      type,
      value: parseFloat(value),
      min_order_value: parseFloat(min_order_value || 0),
      max_discount: max_discount ? parseFloat(max_discount) : null,
      usage_limit: parseInt(usage_limit, 10) || 100,
      per_user_limit: per_user_limit ? parseInt(per_user_limit, 10) : null,
      start_date: start_date || null,
      expiry_date: expiry_date || null,
      applicable_products: applicable_products ? (typeof applicable_products === 'string' ? applicable_products : JSON.stringify(applicable_products)) : null,
      applicable_categories: applicable_categories ? (typeof applicable_categories === 'string' ? applicable_categories : JSON.stringify(applicable_categories)) : null,
      is_active: !!is_active
    });

    return res.status(201).json({ success: true, message: 'Coupon created successfully.', coupon });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to create coupon.', error: error.message });
  }
};

export const deleteCoupon = (models) => async (req, res) => {
  try {
    const { id } = req.params;
    const coupon = await models.Coupon.findByPk(id);

    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    await coupon.destroy();
    return res.json({ success: true, message: 'Coupon deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete coupon.', error: error.message });
  }
};

export const toggleCoupon = (models) => async (req, res) => {
  try {
    const { id } = req.params;
    const coupon = await models.Coupon.findByPk(id);

    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    coupon.is_active = !coupon.is_active;
    await coupon.save();

    return res.json({
      success: true,
      message: `Coupon ${coupon.is_active ? 'activated' : 'deactivated'}.`,
      is_active: coupon.is_active
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to toggle coupon.', error: error.message });
  }
};

