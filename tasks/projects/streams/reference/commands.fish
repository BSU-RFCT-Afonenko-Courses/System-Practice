cat < headers.txt | grep '^Last-Modified:' > last-modified.txt
cat < headers.txt | grep '^Last-Modified:' >> last-modified.txt
cat missing.txt 2> errors.txt
