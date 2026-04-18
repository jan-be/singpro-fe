import React from "react";
import { useTranslation } from "react-i18next";
import Footer from "../components/Footer";
import { Link } from "react-router-dom";
import MyIcon from "../icon.svg?react";
import { useLangPath } from "../GlobalConsts";

const WrapperPage = props => {
  const lp = useLangPath();

  return (
    <div className="flex flex-col min-h-screen">
      <nav className="bg-surface-light border-b border-surface-lighter">
        <div className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 py-3 flex items-center">
          <Link to={lp('/')} className="flex items-center gap-2 no-underline transition-colors">
            <MyIcon width="24" height="24" />
            <span className="text-lg font-extrabold bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-magenta bg-clip-text text-transparent leading-normal">singpro.app</span>
          </Link>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl xl:max-w-5xl 2xl:max-w-6xl w-full mx-auto px-4 py-10">
        {props.children}
      </main>

      <Footer />
    </div>
  );
};

export default WrapperPage;
