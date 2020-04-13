import React, { useEffect, useState } from 'react';
import { apiDomain } from "../GlobalConsts";
import lunr from "lunr";
import { TextField, Typography } from "@material-ui/core";
import { Link } from "react-router-dom";

const SearchBar = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [songTitles, setSongTitles] = useState([]);
  const [songSearchItemsToShow, setSongSearchItemsToShow] = useState([]);
  const [idx, setIdx] = useState(null);

  useEffect(() => {
      (async () => {
        const resp = await fetch(`https://${apiDomain}/songs`);
        const jsonObj = await resp.json();

        setSongTitles(jsonObj.data);

        let idx = lunr(function () {
          this.field("title");
          this.field("artist");

          for (let [i, item] of jsonObj.data.entries()) {
            this.add({ ...item, id: i });
          }
        });

        setIdx(idx);
      })();
    },
    []);

  const handleSearchTermChange = event => {
    let newTerm = event.target.value;
    setSearchTerm(newTerm);
    if (newTerm.length >= 2) {
      let searchResult = idx.search(newTerm);
      const newItems = searchResult
        .map(e => songTitles[e.ref])
        .slice(0, 50);
      setSongSearchItemsToShow(newItems);
    } else {
      setSongSearchItemsToShow([]);
    }
  };

  return (
    <div>
      <TextField variant="outlined" value={searchTerm} onChange={handleSearchTermChange}/>
      {songSearchItemsToShow.map((e, i) => {
        let dashTitle = `${e.artist.replace(/[\W]+/g,"_")}--${e.title.replace(/[\W ]+/g,"_")}`

        return (
          <div key={i}>
            <Typography component={Link} to={`/sing/${dashTitle}/${e.hash}`}>{e.artist} - {e.title}</Typography>
          </div>);
      })}
    </div>
  );
};

export default SearchBar;
