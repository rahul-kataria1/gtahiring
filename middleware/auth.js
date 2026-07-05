// Makes the logged-in user (if any) available to every view as `currentUser`.
function attachUser(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  next();
}

// Blocks access unless someone is logged in.
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// Blocks access unless the logged-in user has one of the allowed roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Access denied',
        message: "You don't have permission to view this page.",
      });
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requireRole };
