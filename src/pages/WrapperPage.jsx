import React from "react";
import Footer from "../components/Footer";
import { Link } from "react-router-dom";
import MyIcon from "../icon.svg?react";
import AccountMenu from "../components/AccountMenu";

const WrapperPage = props => {
  return (
    <div className="flex flex-col min-h-screen">
      <nav className="bg-surface-light/90 backdrop-blur-sm border-b border-surface-lighter relative z-40">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/30 to-transparent" />
        <div className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 no-underline transition-colors">
            <MyIcon width="24" height="24" />
            <span className="text-lg font-extrabold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta bg-clip-text text-transparent leading-normal">singpro.app</span>
          </Link>
          <AccountMenu />
        </div>
      </nav>

      <main className="flex-1 max-w-3xl xl:max-w-5xl 2xl:max-w-6xl w-full mx-auto px-4 py-10">
        {props.children}
      </main>

      {!props.hideFooter && <Footer />}
    </div>
  );
};

export default WrapperPage;
