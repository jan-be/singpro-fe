import { Link } from "react-router-dom";
import React from "react";

const Footer = () => {
  return (
    <footer className="mt-auto py-6 px-4 bg-surface border-t border-surface-lighter">
      <div className="max-w-xl mx-auto flex justify-center gap-6 text-sm">
        <Link to="/privacy-policy" className="text-gray-400 hover:text-neon-cyan transition-colors">
          Privacy Policy
        </Link>
        <Link to="/tos" className="text-gray-400 hover:text-neon-cyan transition-colors">
          Terms of Service
        </Link>
        <Link to="/contact" className="text-gray-400 hover:text-neon-cyan transition-colors">
          Contact
        </Link>
      </div>
    </footer>
  );
};

export default Footer;
