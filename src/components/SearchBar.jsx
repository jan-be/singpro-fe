import React, { useState } from 'react';
import { apiUrl } from "../GlobalConsts";
import { TextField, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import { urlEscapedTitle } from "../logic/RandomUtility";

const SearchBar = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [songSearchItemsToShow, setSongSearchItemsToShow] = useState([]);

  const handleSearchTermChange = async event => {
    let newTerm = event.target.value;
    setSearchTerm(newTerm);

    if (newTerm.length >= 2) {
      let resp = await fetch(`${apiUrl}/search/${newTerm}`);
      let jsonObj = await resp.json();

      setSongSearchItemsToShow(jsonObj.data);
    } else {
      setSongSearchItemsToShow([]);
    }
  };

  return (
    <div>
      <TextField label="search" variant="outlined" value={searchTerm} onChange={handleSearchTermChange}/>
      {songSearchItemsToShow.map((e, i) => {
        let dashTitle = urlEscapedTitle(e.artist, e.title);

        return (
          <div key={i}>
            <Typography component={Link} to={`/sing/${dashTitle}/${e.songId}`}>{e.artist} - {e.title}</Typography>
          </div>);
      })}
    </div>
  );
};

export default SearchBar;
