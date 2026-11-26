const productIncludes = (models) => [
  { model: models.ProductImage, as: 'images' },
  { model: models.Category, as: 'category' }
];

export const getWishlist = (models) => async (req, res) => {
  try {
    const wishlist = await models.Wishlist.findAll({
      where: { user_id: req.user.id },
      include: [{
        model: models.Product,
        as: 'product',
        required: true,
        include: productIncludes(models)
      }],
      order: [['createdAt', 'ASC']]
    });

    return res.json({
      success: true,
      items: wishlist.map((entry) => ({
        ...entry.product.get({ plain: true }),
        wishlist_id: entry.id
      }))
    });
  } catch (error) {
    console.error('getWishlist error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch wishlist.' });
  }
};

export const addToWishlist = (models) => async (req, res) => {
  try {
    const productId = Number(req.body.product_id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ success: false, message: 'A valid product ID is required.' });
    }

    const product = await models.Product.findByPk(productId, {
      include: productIncludes(models)
    });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    await models.Wishlist.findOrCreate({
      where: { user_id: req.user.id, product_id: productId },
      defaults: { user_id: req.user.id, product_id: productId }
    });

    return res.status(201).json({
      success: true,
      message: 'Item added to wishlist.',
      item: product
    });
  } catch (error) {
    console.error('addToWishlist error:', error);
    return res.status(500).json({ success: false, message: 'Failed to add item to wishlist.' });
  }
};

export const removeFromWishlist = (models) => async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ success: false, message: 'A valid product ID is required.' });
    }

    await models.Wishlist.destroy({
      where: { user_id: req.user.id, product_id: productId }
    });

    return res.json({ success: true, message: 'Item removed from wishlist.' });
  } catch (error) {
    console.error('removeFromWishlist error:', error);
    return res.status(500).json({ success: false, message: 'Failed to remove item from wishlist.' });
  }
};

