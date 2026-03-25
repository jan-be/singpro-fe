import React from "react";
import Footer from "../components/Footer";
import { Link } from "react-router-dom";
import MyIcon from "../icon.svg?react";

const WrapperPage = props => {
  return (
    <div className="flex flex-col min-h-screen">
      <nav className="bg-surface-light border-b border-surface-lighter">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center">
          <Link to="/" className="flex items-center gap-2 text-white no-underline hover:text-neon-cyan transition-colors">
            <MyIcon width="24" height="24" />
            <span className="text-lg font-bold">SingPro</span>
          </Link>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-10">
        {props.children}
      </main>

      <Footer />
    </div>
  );
};

export default WrapperPage;
